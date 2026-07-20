/**
 * ai-profiles/hooks/useTestChatStream
 * -----------------------------
 * Owns Test Chat SSE streaming, completion-mode send, session lifecycle, and
 * OAuth tool-auth resume. Extracted from TestChatPanel.tsx (FE-11) so the panel
 * stays a thin view. Behavior is preserved from the original embedded logic.
 */

import { useState, useEffect, useRef, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import * as api from '../../../../services/api';
import type { AiProfile } from '../../../../types/api';
import { getSessionUser } from '../../../../lib/auth-session';
import {
  type TestChatMessage,
  type PendingAuth,
  type TestChatApiResult,
  friendlyToolName,
  finalizeStreamingMessages,
  appendStreamError,
  applyAssistantDelta,
  extractTextDelta,
} from '../../../../lib/test-chat-stream';

export type { TestChatMessage, PendingAuth };

export interface UseTestChatStreamArgs {
  profileId: string;
  profile: AiProfile;
}

type SetMessages = Dispatch<SetStateAction<TestChatMessage[]>>;
type ActiveReaderRef = MutableRefObject<ReadableStreamDefaultReader<Uint8Array> | null>;

interface ProcessStreamDeps {
  activeReaderRef: ActiveReaderRef;
  addToolMessage: (toolMsg: TestChatMessage) => void;
  setPendingAuth: Dispatch<SetStateAction<PendingAuth | null>>;
  setMessages: SetMessages;
}

interface SseEventHandlers {
  appendDelta: (delta: string) => void;
  addToolMessage: (toolMsg: TestChatMessage) => void;
  setPendingAuth: Dispatch<SetStateAction<PendingAuth | null>>;
}

/** Dispatch one parsed SSE JSON payload into tool / text handlers. */
function handleSseEvent(parsed: Record<string, unknown>, handlers: SseEventHandlers): void {
  /* ── tool.call: AI wants to invoke a tool ── */
  if (parsed.type === 'tool.call') {
    const calls = (parsed.calls as Array<Record<string, unknown>>) || [];
    for (const call of calls) {
      const args = call.arguments as Record<string, unknown> | undefined;
      const callType = call.type as string | undefined;
      const requiresAuth = Boolean(callType?.includes('mcp') && args?.requiresUserAction);
      handlers.addToolMessage({
        role: 'tool',
        toolEvent: 'invocation',
        toolName: friendlyToolName(callType),
        toolCallId: call.id as string | undefined,
        arguments: args,
        requiresAuth,
        messageId: parsed.messageId as string | undefined,
      });
    }
    return;
  }

  /* ── tool.message: result of a tool call ── */
  if (parsed.type === 'tool.message') {
    const meta = (parsed.metadata as Record<string, unknown>) || {};
    handlers.addToolMessage({
      role: 'tool',
      toolEvent: 'result',
      toolCallId: parsed.toolCallId as string | undefined,
      status: parsed.status as string | undefined,
      output: parsed.output as string | Record<string, unknown> | undefined,
      messageId: parsed.messageId as string | undefined,
      requiresUserAction: meta.requiresUserAction === true,
    });
    if (meta.requiresUserAction === true) {
      handlers.setPendingAuth({
        toolCallId: parsed.toolCallId as string,
        messageId: parsed.messageId as string,
        authUrl: (meta.authUrl as string | null) || null,
      });
    }
    return;
  }

  /* ── message.complete / message.created: no UI side effects ── */
  if (parsed.type === 'message.complete' || parsed.type === 'message.created') {
    return;
  }

  /* ── text deltas ── */
  const delta = extractTextDelta(parsed);
  if (delta && delta.trim()) handlers.appendDelta(delta);
}

/**
 * Process SSE lines from a stream response. Handles text deltas,
 * tool.call events, tool.message events, and message.complete.
 * Returns the accumulated assistant text content.
 */
async function processStream(response: Response, deps: ProcessStreamDeps): Promise<string> {
  if (!response.body) throw new Error('No response body');
  const reader = response.body.getReader();
  deps.activeReaderRef.current = reader;
  const decoder = new TextDecoder();
  let assistantContent = '';
  let buffer = '';

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

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(dataStr) as Record<string, unknown>;
      } catch {
        continue;
      }

      handleSseEvent(parsed, {
        appendDelta: (delta: string) => {
          assistantContent += delta;
          deps.setMessages((prev) => applyAssistantDelta(prev, assistantContent));
        },
        addToolMessage: deps.addToolMessage,
        setPendingAuth: deps.setPendingAuth,
      });
    }
  }

  deps.activeReaderRef.current = null;
  return assistantContent;
}

async function sendChatStreamMessage(args: {
  profileId: string;
  textToSend: string;
  systemPrompt: string;
  chatSessionId: string | null;
  setChatSessionId: Dispatch<SetStateAction<string | null>>;
  setMessages: SetMessages;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  streamDeps: ProcessStreamDeps;
}): Promise<void> {
  const {
    profileId,
    textToSend,
    systemPrompt,
    chatSessionId,
    setChatSessionId,
    setMessages,
    setIsStreaming,
    streamDeps,
  } = args;

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

    await processStream(response, streamDeps);
    setMessages((prev) => finalizeStreamingMessages(prev));
  } catch (err: unknown) {
    streamDeps.activeReaderRef.current = null;
    setMessages((prev) => appendStreamError(prev, `Error: ${err instanceof Error ? err.message : String(err)}`));
  } finally {
    setIsStreaming(false);
  }
}

async function sendCompletionMessage(args: {
  profileId: string;
  textToSend: string;
  systemPrompt: string;
  setMessages: SetMessages;
  setSending: Dispatch<SetStateAction<boolean>>;
}): Promise<void> {
  const { profileId, textToSend, systemPrompt, setMessages, setSending } = args;
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

async function resumeAfterAuth(args: {
  pendingAuth: PendingAuth;
  chatSessionId: string;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setPendingAuth: Dispatch<SetStateAction<PendingAuth | null>>;
  setMessages: SetMessages;
  streamDeps: ProcessStreamDeps;
}): Promise<void> {
  const { pendingAuth, chatSessionId, setIsStreaming, setPendingAuth, setMessages, streamDeps } = args;
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
    await processStream(response, streamDeps);
    setMessages((prev) => finalizeStreamingMessages(prev));
  } catch (err: unknown) {
    streamDeps.activeReaderRef.current = null;
    const errMsg = err instanceof Error ? err.message : String(err);
    setMessages((prev) => appendStreamError(prev, `Error resuming: ${errMsg}`));
  } finally {
    setIsStreaming(false);
  }
}

export function useTestChatStream({ profileId, profile }: UseTestChatStreamArgs) {
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
    const readerRef = activeReaderRef;
    const sessionRef = chatSessionIdRef;
    return () => {
      if (readerRef.current) {
        readerRef.current.cancel().catch(() => {});
      }
      if (sessionRef.current) {
        api.closeChatSession(sessionRef.current).catch(() => {});
      }
    };
  }, []);

  function addToolMessage(toolMsg: TestChatMessage) {
    setMessages((prev) => [...prev, toolMsg]);
  }

  const streamDeps: ProcessStreamDeps = {
    activeReaderRef,
    addToolMessage,
    setPendingAuth,
    setMessages,
  };

  async function handleSend(nextText: string | null = null) {
    const textToSend = String(nextText ?? input).trim();
    if (!textToSend || sending || isStreaming) return;

    setMessages((prev) => [...prev, { role: 'user', content: textToSend }]);
    if (!nextText) setInput('');

    if (profile?.mode === 'chat') {
      await sendChatStreamMessage({
        profileId,
        textToSend,
        systemPrompt,
        chatSessionId,
        setChatSessionId,
        setMessages,
        setIsStreaming,
        streamDeps,
      });
    } else {
      await sendCompletionMessage({
        profileId,
        textToSend,
        systemPrompt,
        setMessages,
        setSending,
      });
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

  async function handleResumeAfterAuth() {
    if (!pendingAuth || !chatSessionId) return;
    await resumeAfterAuth({
      pendingAuth,
      chatSessionId,
      setIsStreaming,
      setPendingAuth,
      setMessages,
      streamDeps,
    });
  }

  return {
    messages,
    input,
    setInput,
    systemPrompt,
    setSystemPrompt,
    sending,
    isStreaming,
    chatSessionId,
    pendingAuth,
    scrollRef,
    handleSend,
    handleResetChat,
    handleResumeAfterAuth,
  };
}
