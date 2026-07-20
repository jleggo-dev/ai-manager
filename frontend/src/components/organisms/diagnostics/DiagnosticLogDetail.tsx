/**
 * Diagnostic log detail panel — timing, routing, request/response payloads.
 */

import { Stack, Group, Text, Badge, ActionIcon, Alert, Code, Paper, ScrollArea, Box } from '@mantine/core';
import { IconX, IconCircleX } from '@tabler/icons-react';
import type { DiagnosticLog, DiagnosticSupabaseTimingOp } from '../../../types/api';

interface DiagnosticLogDetailProps {
  log: DiagnosticLog;
  onClose: () => void;
}

export function DiagnosticLogDetail({ log, onClose }: DiagnosticLogDetailProps) {
  const failoverUsed = String(log.metadata?.failoverUsed) === 'true';

  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" mb="sm">
        <Text fw={600} size="sm">
          Log Detail
        </Text>
        <ActionIcon variant="subtle" onClick={onClose}>
          <IconX size={14} />
        </ActionIcon>
      </Group>

      <Stack gap="sm">
        <Paper withBorder p="xs">
          <Group gap="lg" wrap="wrap">
            <Box>
              <Text size="xs" c="dimmed">
                Status
              </Text>
              <Badge color={log.status === 'success' ? 'green' : 'red'} size="sm">
                {log.status}
              </Badge>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                Duration
              </Text>
              <Text size="xs" fw={500}>
                {log.total_duration_ms}ms
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                Calling App
              </Text>
              <Text size="xs" fw={500}>
                {log.calling_application}
              </Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">
                Timestamp
              </Text>
              <Text size="xs">{new Date(log.created_at).toLocaleString()}</Text>
            </Box>
          </Group>
        </Paper>

        {log.error_message && (
          <Alert color="red" variant="light" icon={<IconCircleX size={14} />}>
            <Text size="xs">{log.error_message}</Text>
          </Alert>
        )}

        {log.supabase_timing && (
          <Paper withBorder p="xs">
            <Text size="xs" fw={600} mb={4}>
              Supabase Operations
            </Text>
            {(Array.isArray(log.supabase_timing) ? log.supabase_timing : []).map(
              (op: DiagnosticSupabaseTimingOp, i: number) => (
                <Group key={`op-${i}`} gap="xs" mb={2}>
                  <Badge size="xs" color={op.success ? 'green' : 'red'} variant="light">
                    {op.durationMs}ms
                  </Badge>
                  <Text size="xs">{op.operation}</Text>
                  {op.error && (
                    <Text size="xs" c="red">
                      {op.error}
                    </Text>
                  )}
                </Group>
              ),
            )}
          </Paper>
        )}

        {log.llm_timing && (
          <Paper withBorder p="xs">
            <Text size="xs" fw={600} mb={4}>
              LLM Call
            </Text>
            <Group gap="lg" mb={4} wrap="wrap">
              <Box>
                <Text size="xs" c="dimmed">
                  Duration
                </Text>
                <Text size="xs" fw={500}>
                  {log.llm_timing.durationMs}ms
                </Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  Model
                </Text>
                <Text size="xs">{log.llm_timing.model}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  Provider
                </Text>
                <Text size="xs">{log.llm_timing.provider}</Text>
              </Box>
            </Group>
            {log.llm_response?.usage ? (
              <Group gap="lg" mt={4} wrap="wrap">
                <Box>
                  <Text size="xs" c="dimmed">
                    Prompt Tokens
                  </Text>
                  <Text size="xs" fw={500}>
                    {(log.llm_response.usage.prompt_tokens ?? 0).toLocaleString()}
                  </Text>
                </Box>
                <Box>
                  <Text size="xs" c="dimmed">
                    Completion Tokens
                  </Text>
                  <Text size="xs" fw={500}>
                    {(log.llm_response.usage.completion_tokens ?? 0).toLocaleString()}
                  </Text>
                </Box>
                <Box>
                  <Text size="xs" c="dimmed">
                    Total Tokens
                  </Text>
                  <Text size="xs" fw={600} c="blue">
                    {(log.llm_response.usage.total_tokens ?? 0).toLocaleString()}
                  </Text>
                </Box>
              </Group>
            ) : (
              <Text size="xs" c="dimmed" mt={4}>
                Token usage not available for this provider
              </Text>
            )}
          </Paper>
        )}

        {log.metadata && (
          <Paper
            withBorder
            p="xs"
            style={
              failoverUsed
                ? {
                    borderLeft: '3px solid var(--mantine-color-orange-5)',
                    background: 'var(--mantine-color-orange-0)',
                  }
                : undefined
            }
          >
            <Text size="xs" fw={600} mb={4}>
              Model Routing
            </Text>
            <Group gap="lg" wrap="wrap">
              <Box>
                <Text size="xs" c="dimmed">
                  Primary Model
                </Text>
                <Text size="xs">{log.metadata.primaryModel || '—'}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  Failover Model
                </Text>
                <Text size="xs">{log.metadata.failoverModel || '—'}</Text>
              </Box>
              {log.metadata.failoverProviderName && (
                <Box>
                  <Text size="xs" c="dimmed">
                    Failover Provider
                  </Text>
                  <Text size="xs">
                    {log.metadata.failoverProviderName} ({log.metadata.failoverProviderType || '?'})
                  </Text>
                </Box>
              )}
              <Box>
                <Text size="xs" c="dimmed">
                  Failover Used
                </Text>
                <Badge size="xs" color={failoverUsed ? 'orange' : 'gray'} variant={failoverUsed ? 'filled' : 'light'}>
                  {failoverUsed ? 'Yes — Failover Triggered' : 'No'}
                </Badge>
              </Box>
            </Group>
            {log.metadata.primaryModelError && (
              <Alert mt="xs" variant="light" color="orange">
                <Text size="xs" fw={500}>
                  Primary Error:
                </Text>
                <Text size="xs">{log.metadata.primaryModelError}</Text>
              </Alert>
            )}
          </Paper>
        )}

        {log.formatting_timing && (
          <Paper withBorder p="xs">
            <Text size="xs" fw={600} mb={4}>
              Formatting
            </Text>
            <Group gap="lg">
              <Box>
                <Text size="xs" c="dimmed">
                  Duration
                </Text>
                <Text size="xs" fw={500}>
                  {log.formatting_timing.durationMs}ms
                </Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">
                  Rules Applied
                </Text>
                <Text size="xs">{log.formatting_timing.rulesApplied}</Text>
              </Box>
            </Group>
          </Paper>
        )}

        {log.request_payload && (
          <Paper withBorder p="xs">
            <Text size="xs" fw={600} mb={4}>
              Request Payload
            </Text>
            <ScrollArea h={250}>
              <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(log.request_payload, null, 2)}
              </Code>
            </ScrollArea>
          </Paper>
        )}

        {log.llm_request && (
          <Paper withBorder p="xs">
            <Text size="xs" fw={600} mb={4}>
              Prompt Sent to LLM
            </Text>
            {log.llm_request.promptContent ? (
              <ScrollArea h={300}>
                <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                  {log.llm_request.promptContent}
                </Code>
              </ScrollArea>
            ) : (
              <ScrollArea h={200}>
                <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(log.llm_request, null, 2)}
                </Code>
              </ScrollArea>
            )}
            {log.llm_request.promptLength && (
              <Text size="xs" c="dimmed" mt={4}>
                {log.llm_request.promptLength.toLocaleString()} characters
                {log.llm_request.model ? ` • Model: ${log.llm_request.model}` : ''}
                {log.llm_request.provider ? ` • Provider: ${log.llm_request.provider}` : ''}
              </Text>
            )}
          </Paper>
        )}

        {log.llm_response && (
          <Paper withBorder p="xs">
            <Text size="xs" fw={600} mb={4}>
              LLM Response
            </Text>
            {log.llm_response.rawContent ? (
              <ScrollArea h={300}>
                <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                  {log.llm_response.rawContent}
                </Code>
              </ScrollArea>
            ) : (
              <ScrollArea h={200}>
                <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(log.llm_response, null, 2)}
                </Code>
              </ScrollArea>
            )}
            {(log.llm_response.usage || log.llm_response.finishReason) && (
              <Group gap="lg" mt={4}>
                {log.llm_response.usage && (
                  <Text size="xs" c="dimmed">
                    Tokens — prompt: {log.llm_response.usage.prompt_tokens?.toLocaleString()}, completion:{' '}
                    {log.llm_response.usage.completion_tokens?.toLocaleString()}, total:{' '}
                    {log.llm_response.usage.total_tokens?.toLocaleString()}
                  </Text>
                )}
                {log.llm_response.finishReason && (
                  <Text size="xs" c="dimmed">
                    Finish: {log.llm_response.finishReason}
                  </Text>
                )}
                {log.llm_response.rawLength && (
                  <Text size="xs" c="dimmed">
                    {log.llm_response.rawLength.toLocaleString()} chars
                  </Text>
                )}
              </Group>
            )}
          </Paper>
        )}
      </Stack>
    </Paper>
  );
}
