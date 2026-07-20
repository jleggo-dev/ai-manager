import { Stack, Group, Text, Badge, Code, ScrollArea, Alert } from '@mantine/core';
import { IconClock } from '@tabler/icons-react';
import type { DiagnosticLog } from '../../../types/api';
import { formatMs, statusColor } from './types';

export function DiagnosticDetail({ diagnostic }: { diagnostic: DiagnosticLog | null }) {
  if (!diagnostic) {
    return (
      <Text size="xs" c="dimmed">
        No diagnostic log recorded for this step. Ensure diagnostics are enabled on the processing job.
      </Text>
    );
  }

  const meta = diagnostic.metadata ?? {};
  const llmTiming = diagnostic.llm_timing;
  const usage = diagnostic.llm_response?.usage ?? {};

  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="wrap">
        <Badge size="xs" color={statusColor(diagnostic.status)}>
          {diagnostic.status}
        </Badge>
        {diagnostic.total_duration_ms != null && (
          <Badge size="xs" variant="light" leftSection={<IconClock size={10} />}>
            {formatMs(diagnostic.total_duration_ms)}
          </Badge>
        )}
        {llmTiming && (
          <Badge size="xs" variant="light" color="violet">
            LLM: {formatMs(llmTiming.durationMs)}
          </Badge>
        )}
        {usage.prompt_tokens != null && (
          <Badge size="xs" variant="light">
            {String(usage.prompt_tokens)} / {String(usage.completion_tokens)} tokens
          </Badge>
        )}
      </Group>

      {llmTiming && (
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            Provider:
          </Text>
          <Code style={{ fontSize: 11 }}>{String(llmTiming.provider ?? '—')}</Code>
          <Text size="xs" c="dimmed">
            Model:
          </Text>
          <Code style={{ fontSize: 11 }}>{String(llmTiming.model ?? meta.streamModel ?? '—')}</Code>
        </Group>
      )}

      {diagnostic.error_message && (
        <Alert color="red" title="Error" p="xs">
          <Text size="xs">{diagnostic.error_message}</Text>
        </Alert>
      )}

      {diagnostic.request_payload && (
        <>
          <Text size="xs" fw={600} mt="xs">
            Request Payload
          </Text>
          <ScrollArea mah={200}>
            <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(diagnostic.request_payload, null, 2)}
            </Code>
          </ScrollArea>
        </>
      )}

      {Object.keys(meta).length > 0 && (
        <>
          <Text size="xs" fw={600} mt="xs">
            Metadata
          </Text>
          <ScrollArea mah={200}>
            <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(meta, null, 2)}
            </Code>
          </ScrollArea>
        </>
      )}
    </Stack>
  );
}
