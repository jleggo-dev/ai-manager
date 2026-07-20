/**
 * ai-profiles/TestChatPanel
 * -----------------------------
 * Thin chat UI to test AI profiles (agent + model, completion + chat mode).
 * Streaming, session lifecycle, and tool-auth resume live in useTestChatStream
 * (FE-11). Preset prompt text comes from lib/test-chat-stream.
 */

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
import type { AiProfile } from '../../../types/api';
import { buildToolsPresetPrompt, type TestChatMessage } from '../../../lib/test-chat-stream';
import { useTestChatStream } from './hooks/useTestChatStream';

interface TestChatPanelProps {
  profileId: string;
  profileName: string;
  profile: AiProfile;
}

export default function TestChatPanel({ profileId, profileName, profile }: TestChatPanelProps) {
  const {
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
  } = useTestChatStream({ profileId, profile });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
              setInput(buildToolsPresetPrompt(profile));
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
