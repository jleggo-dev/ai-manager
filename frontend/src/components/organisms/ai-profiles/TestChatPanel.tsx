/**
 * ai-profiles/TestChatPanel
 * -----------------------------
 * Simple chat interface to test AI profiles (agent + model, completion + chat mode).
 * Owns its own SSE streaming state and the tool-call/OAuth-auth-required flow for
 * chat-mode profiles. Moved out of AiProfileManager.tsx as a file-move-only step
 * (FE-02) — logic is unchanged from the original embedded component.
 *
 * Follow-up (logged, not done here): extract a `useTestChatStream` hook from this
 * component to isolate the SSE parsing / OAuth-resume logic from rendering.
 */

import { useState, useEffect, useRef } from 'react';
import {
  Stack,
  Group,
  Button,
  TextInput,
  Textarea,
  Loader,
  Center,
  Text,
  Badge,
  Paper,
  ScrollArea,
  Code,
  ActionIcon,
} from '@mantine/core';
import { IconSend, IconFlask2, IconRefresh } from '@tabler/icons-react';
import * as api from '../../../services/api';
import type { AiProfile } from '../../../types/api';
import { getSessionUser } from '../../../lib/auth-session';

interface TestChatMessage {
  id?: string;
  role: string;
  content?: string;
  streaming?: boolean;
  meta?: {
    duration?: number;
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  toolEvent?: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  status?: string;
  output?: string | Record<string, unknown>;
  requiresAuth?: boolean;
  requiresUserAction?: boolean;
  messageId?: string;
}

interface PendingAuth {
  toolCallId: string;
  messageId: string;
  authUrl: string | null;
}

interface TestChatApiResult {
  content: string;
  durationMs?: number;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface TestChatPanelProps {
  profileId: string;
  profileName: string;
  profile: AiProfile;
}

export default function TestChatPanel({ profileId, profileName, profile }: TestChatPanelProps) {
  const [messages, setMessages] = useState<TestChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | null>(null);
  const chatSessionIdRef = useRef<string | null>(null);
  const activeReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages]);

  useEffect(() => {
    chatSessionIdRef.current = chatSessionId;
  }, [chatSessionId]);

  useEffect(() => {
    return () => {
      if (activeReaderRef.current) {
        activeReaderRef.current.cancel().catch(() => {});
      }
      if (chatSessionIdRef.current) {
        api.closeChatSession(chatSessionIdRef.current).catch(() => {});
      }
    };
  }, []);

  const providerType = String(profile?.provider?.type || '')
    .trim()
    .toLowerCase();
  const rtOpts = profile?.runtime_options ?? {};
  const devsAiRaw = rtOpts.devs_ai;
  const devsAiOptions = (devsAiRaw && typeof devsAiRaw === 'object' ? devsAiRaw : {}) as Record<string, unknown>;
  const geminiRaw = rtOpts.google_gemini;
  const geminiOptions = (geminiRaw && typeof geminiRaw === 'object' ? geminiRaw : {}) as Record<string, unknown>;
  const enabledToolIds: string[] = Array.isArray(devsAiOptions.built_in_tools)
    ? (devsAiOptions.built_in_tools as unknown[]).map((t) => String(t || '').trim()).filter(Boolean)
    : [];

  function buildToolsPresetPrompt() {
    if (providerType === 'devs-ai') {
      const toolList = enabledToolIds.length > 0 ? enabledToolIds.join(', ') : 'none';
      return [
        'Run a runtime-tools smoke test for this profile.',
        `Enabled tools configured on this profile: ${toolList}.`,
        'If web_search is enabled, run one web lookup and include at least one source URL.',
        'If python is enabled, run a tiny calculation (e.g., 37*19) and include the result.',
        'If spreadsheet is enabled, show a tiny 2-row table transformed into CSV.',
        'If memory is enabled, store a short key/value and confirm it was saved.',
        'If sandbox is enabled, run a trivial sandbox action and summarize outcome.',
        'Return compact JSON with: toolsDetected, toolsUsed, checks, and notes.',
      ].join('\n');
    }

    if (providerType === 'google-gemini') {
      const grounding = geminiOptions?.grounding_with_google_search === true;
      return grounding
        ? [
            'Run a grounding smoke test.',
            'Use Google Search grounding to answer: "What is the latest official news about Gemini API pricing?"',
            'Include citation URLs and state that grounding was used.',
          ].join('\n')
        : [
            'Run a non-grounded response smoke test.',
            'Answer this from model knowledge only: "Summarize what grounding in Gemini means in 3 bullets."',
            'Do not use web lookups.',
          ].join('\n');
    }

    return [
      'Run a basic tool/runtime smoke test for this profile.',
      'Describe whether any provider runtime options seem active in this response.',
    ].join('\n');
  }

  /** Friendly tool name extracted from MCP tool type like mcp__<id>__listFiles */
  function friendlyToolName(toolType: string | null | undefined) {
    if (!toolType) return 'unknown tool';
    const parts = toolType.split('__');
    return parts.length >= 3 ? parts[parts.length - 1] : toolType;
  }

  /** Add a tool-event message to the chat (tool invocation, result, or OAuth prompt) */
  function addToolMessage(toolMsg: TestChatMessage) {
    setMessages((prev) => [...prev, toolMsg]);
  }

  /**
   * Process SSE lines from a stream response. Handles text deltas,
   * tool.call events, tool.message events, and message.complete.
   * Returns the accumulated assistant text content.
   */
  async function processStream(response: Response) {
    if (!response.body) throw new Error('No response body');
    const reader = response.body.getReader();
    activeReaderRef.current = reader;
    const decoder = new TextDecoder();
    let assistantContent = '';
    let buffer = '';
    let lastMessageId = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') continue;

        let parsed;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          continue;
        }

        /* ── tool.call: AI wants to invoke a tool ── */
        if (parsed.type === 'tool.call') {
          lastMessageId = parsed.messageId || lastMessageId;
          const calls = parsed.calls || [];
          for (const call of calls) {
            const requiresAuth = call.type?.includes('mcp') && call.arguments?.requiresUserAction;
            addToolMessage({
              role: 'tool',
              toolEvent: 'invocation',
              toolName: friendlyToolName(call.type),
              toolCallId: call.id,
              arguments: call.arguments,
              requiresAuth,
              messageId: parsed.messageId,
            });
          }
          continue;
        }

        /* ── tool.message: result of a tool call ── */
        if (parsed.type === 'tool.message') {
          const meta = parsed.metadata || {};
          addToolMessage({
            role: 'tool',
            toolEvent: 'result',
            toolCallId: parsed.toolCallId,
            status: parsed.status,
            output: parsed.output,
            messageId: parsed.messageId,
            requiresUserAction: meta.requiresUserAction === true,
          });
          if (meta.requiresUserAction === true) {
            setPendingAuth({
              toolCallId: parsed.toolCallId,
              messageId: parsed.messageId,
              authUrl: meta.authUrl || null,
            });
          }
          continue;
        }

        /* ── message.complete: usage info ── */
        if (parsed.type === 'message.complete') {
          lastMessageId = parsed.messageId || lastMessageId;
          continue;
        }

        /* ── message.created: new message in the conversation ── */
        if (parsed.type === 'message.created') {
          lastMessageId = parsed.messageId || lastMessageId;
          continue;
        }

        /* ── text deltas ── */
        const delta =
          parsed.choices?.[0]?.delta?.content ||
          parsed.candidates?.[0]?.content?.parts?.[0]?.text ||
          (typeof parsed.content === 'string' ? parsed.content : parsed.content?.text) ||
          '';

        if (delta && delta.trim()) {
          assistantContent += delta;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last.streaming) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                content: assistantContent,
              };
              return updated;
            }
            return [...prev, { role: 'assistant', content: assistantContent, streaming: true }];
          });
        }
      }
    }

    activeReaderRef.current = null;
    return assistantContent;
  }

  async function handleSend(nextText: string | null = null) {
    const textToSend = String(nextText ?? input).trim();
    if (!textToSend || sending || isStreaming) return;

    const userMsg: TestChatMessage = { role: 'user', content: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    if (!nextText) setInput('');

    if (profile?.mode === 'chat') {
      setIsStreaming(true);
      try {
        let sessionId = chatSessionId;
        if (!sessionId) {
          const session = await api.createChatSession({
            aiProfileId: profileId,
            userId: getSessionUser()?.id || 'admin-test',
            systemPrompt: systemPrompt || undefined,
          });
          sessionId = session.sessionId ?? session.id ?? null;
          setChatSessionId(sessionId);
        }
        if (!sessionId) return;

        setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);

        const response = await api.sendChatMessageStream(sessionId, textToSend);
        if (!response.ok) {
          const errBody = await response.json().catch((): Record<string, unknown> => ({}));
          throw new Error(String(errBody.error || `Stream request failed (${response.status})`));
        }

        await processStream(response);

        setMessages((prev) => {
          const updated = [...prev];
          let lastIdx = -1;
          for (let i = updated.length - 1; i >= 0; i--) {
            const msg = updated[i];
            if (msg && msg.role === 'assistant' && msg.streaming) {
              lastIdx = i;
              break;
            }
          }
          const target = lastIdx >= 0 ? updated[lastIdx] : undefined;
          if (lastIdx >= 0 && target) updated[lastIdx] = { ...target, streaming: false };
          return updated;
        });
      } catch (err: unknown) {
        activeReaderRef.current = null;
        setMessages((prev) => {
          const cleaned = prev.filter((m) => !(m.role === 'assistant' && m.streaming && !m.content));
          return [
            ...cleaned,
            {
              role: 'error',
              content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ];
        });
      } finally {
        setIsStreaming(false);
      }
    } else {
      setSending(true);
      try {
        const data = (await api.testAiProfileChat(
          profileId,
          textToSend,
          systemPrompt || undefined,
        )) as unknown as TestChatApiResult;
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.content,
            meta: {
              duration: data.durationMs,
              model: data.model,
              usage: data.usage,
            },
          },
        ]);
      } catch (err: unknown) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'error',
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]);
      } finally {
        setSending(false);
      }
    }
  }

  async function handleResetChat() {
    if (chatSessionId) {
      try {
        await api.resetChatSession(chatSessionId);
      } catch (_e) {
        /* ignore */
      }
    }
    setChatSessionId(null);
    setMessages([]);
    setPendingAuth(null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  /**
   * Resume the AI conversation after the user has completed OAuth authorization.
   * Submits a tool output indicating auth was completed, then processes the
   * continuation stream.
   */
  async function handleResumeAfterAuth() {
    if (!pendingAuth || !chatSessionId) return;
    setIsStreaming(true);
    setPendingAuth(null);
    try {
      setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);
      const response = await api.submitChatToolOutputs(chatSessionId, pendingAuth.messageId, [
        {
          toolCallId: pendingAuth.toolCallId,
          output: 'OAuth authorization completed by user.',
        },
      ]);
      if (!response.ok) {
        const errBody = await response.json().catch((): Record<string, unknown> => ({}));
        throw new Error(String(errBody.error || `Tool output submission failed (${response.status})`));
      }
      await processStream(response);
      setMessages((prev) => {
        const updated = [...prev];
        let lastIdx = -1;
        for (let i = updated.length - 1; i >= 0; i--) {
          const msg = updated[i];
          if (msg && msg.role === 'assistant' && msg.streaming) {
            lastIdx = i;
            break;
          }
        }
        const target = lastIdx >= 0 ? updated[lastIdx] : undefined;
        if (lastIdx >= 0 && target) updated[lastIdx] = { ...target, streaming: false };
        return updated;
      });
    } catch (err: unknown) {
      activeReaderRef.current = null;
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => {
        const cleaned = prev.filter((m) => !(m.role === 'assistant' && m.streaming && !m.content));
        return [...cleaned, { role: 'error', content: `Error resuming: ${errMsg}` }];
      });
    } finally {
      setIsStreaming(false);
    }
  }

  /** Render a tool event message (invocation or result) */
  function renderToolMessage(msg: TestChatMessage, i: number) {
    const isInvocation = msg.toolEvent === 'invocation';
    const isResult = msg.toolEvent === 'result';
    const isError = isResult && msg.status === 'error';

    return (
      <Paper
        key={msg.toolCallId || `tool-${i}`}
        p="xs"
        radius="sm"
        withBorder
        bg={isError ? 'red.0' : 'grape.0'}
        style={{ borderLeft: '3px solid var(--mantine-color-grape-5)' }}
      >
        <Group gap="xs" mb={4}>
          <Badge size="xs" variant="filled" color="grape">
            tool
          </Badge>
          {isInvocation && (
            <>
              <Badge size="xs" variant="light" color="blue">
                {msg.toolName}
              </Badge>
              <Text size="xs" c="dimmed">
                invoked
              </Text>
            </>
          )}
          {isResult && (
            <>
              <Badge size="xs" variant="light" color={isError ? 'red' : 'green'}>
                {msg.status || 'success'}
              </Badge>
            </>
          )}
        </Group>
        {isInvocation && msg.arguments && (
          <Code
            block
            style={{
              fontSize: 10,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 120,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(msg.arguments, null, 2)}
          </Code>
        )}
        {isResult && msg.output && (
          <Code
            block
            style={{
              fontSize: 10,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            {typeof msg.output === 'string' ? msg.output : JSON.stringify(msg.output, null, 2)}
          </Code>
        )}
        {isResult && msg.requiresUserAction && pendingAuth && pendingAuth.toolCallId === msg.toolCallId && (
          <Group gap="xs" mt="xs">
            {pendingAuth.authUrl && (
              <Button
                size="compact-xs"
                variant="light"
                color="blue"
                onClick={() => window.open(pendingAuth.authUrl ?? undefined, '_blank', 'noopener')}
              >
                Authorize
              </Button>
            )}
            <Button
              size="compact-xs"
              variant="light"
              color="green"
              onClick={handleResumeAfterAuth}
              disabled={isStreaming}
            >
              Resume after auth
            </Button>
          </Group>
        )}
      </Paper>
    );
  }

  return (
    <Stack gap="sm" h="100%">
      <Textarea
        label="System Prompt (optional)"
        placeholder="Enter a system prompt to test with..."
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        minRows={2}
        maxRows={4}
        styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
      />

      <Group justify="space-between" align="center">
        <Text size="xs" c="dimmed">
          Preset uses this profile&apos;s configured runtime/tool options.
        </Text>
        <Group gap="xs">
          {profile?.mode === 'chat' && chatSessionId && (
            <Button
              size="xs"
              variant="light"
              color="gray"
              leftSection={<IconRefresh size={14} />}
              disabled={isStreaming}
              onClick={handleResetChat}
            >
              Reset Chat
            </Button>
          )}
          <Button
            size="xs"
            variant="light"
            leftSection={<IconFlask2 size={14} />}
            disabled={sending || isStreaming}
            onClick={() => {
              const preset = buildToolsPresetPrompt();
              setInput(preset);
            }}
          >
            Test Tools Preset
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="sm" style={{ flex: 1 }}>
        <Text fw={600} size="sm" mb={4}>
          Chat with {profileName}
        </Text>
        <ScrollArea h={400} viewportRef={scrollRef}>
          <Stack gap="sm">
            {messages.length === 0 && (
              <Center py="xl">
                <Text size="sm" c="dimmed">
                  Send a message to test the AI profile
                </Text>
              </Center>
            )}
            {messages.map((msg, i) =>
              msg.role === 'tool' ? (
                renderToolMessage(msg, i)
              ) : (
                <Paper
                  key={msg.id || `msg-${i}`}
                  p="xs"
                  radius="sm"
                  withBorder={msg.role !== 'user'}
                  bg={msg.role === 'user' ? 'blue.0' : msg.role === 'error' ? 'red.0' : undefined}
                >
                  <Group gap="xs" mb={4}>
                    <Badge
                      size="xs"
                      variant="light"
                      color={msg.role === 'user' ? 'blue' : msg.role === 'error' ? 'red' : 'green'}
                    >
                      {msg.role}
                    </Badge>
                    {msg.meta && (
                      <>
                        <Badge size="xs" variant="outline">
                          {msg.meta.duration}ms
                        </Badge>
                        {msg.meta.usage && (
                          <Badge size="xs" variant="outline">
                            {msg.meta.usage.prompt_tokens + msg.meta.usage.completion_tokens} tokens
                          </Badge>
                        )}
                      </>
                    )}
                  </Group>
                  <Code
                    block
                    style={{
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 300,
                      overflow: 'auto',
                    }}
                  >
                    {msg.content}
                  </Code>
                </Paper>
              ),
            )}
            {(sending || isStreaming) && (
              <Center py="sm">
                <Group gap="xs">
                  <Loader size="sm" />
                  {isStreaming && (
                    <Text size="xs" c="dimmed">
                      Streaming...
                    </Text>
                  )}
                </Group>
              </Center>
            )}
          </Stack>
        </ScrollArea>
      </Paper>

      <Group>
        <TextInput
          style={{ flex: 1 }}
          placeholder="Type your message to test the AI response formatting..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending || isStreaming}
        />
        <ActionIcon
          size="lg"
          variant="filled"
          onClick={() => handleSend()}
          disabled={!input.trim() || sending || isStreaming}
        >
          <IconSend size={16} />
        </ActionIcon>
      </Group>
    </Stack>
  );
}
