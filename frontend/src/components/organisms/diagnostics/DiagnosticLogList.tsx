/**
 * Diagnostic log list — selectable rows for a processing job.
 */

import { Stack, Group, Text, Badge, Paper, ScrollArea, Box } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import type { DiagnosticLog } from '../../../types/api';

interface DiagnosticLogListProps {
  logs: DiagnosticLog[];
  selectedLog: DiagnosticLog | null;
  onSelect: (log: DiagnosticLog) => void;
}

export function DiagnosticLogList({ logs, selectedLog, onSelect }: DiagnosticLogListProps) {
  return (
    <Paper withBorder p="sm">
      <ScrollArea h={600}>
        <Stack gap={4}>
          {logs.map((log) => {
            const logFailover = String(log.metadata?.failoverUsed) === 'true';
            return (
              <Paper
                key={log.id}
                withBorder
                p="xs"
                style={{
                  cursor: 'pointer',
                  borderColor: selectedLog?.id === log.id ? 'var(--mantine-color-blue-5)' : undefined,
                  borderWidth: selectedLog?.id === log.id ? 2 : 1,
                  borderLeft: logFailover ? '3px solid var(--mantine-color-orange-5)' : undefined,
                }}
                onClick={() => onSelect(log)}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Box>
                    <Group gap={4}>
                      <Badge
                        size="xs"
                        color={log.status === 'success' ? 'green' : log.status === 'error' ? 'red' : 'yellow'}
                        variant="filled"
                      >
                        {log.status}
                      </Badge>
                      {logFailover && (
                        <Badge size="xs" color="orange" variant="light">
                          Failover
                        </Badge>
                      )}
                      <Text size="xs" fw={500}>
                        {log.calling_application}
                      </Text>
                    </Group>
                    <Text size="xs" c="dimmed" mt={2}>
                      {new Date(log.created_at).toLocaleString()} — {log.total_duration_ms}ms
                      {log.llm_response?.usage?.total_tokens != null && (
                        <> — {log.llm_response.usage.total_tokens.toLocaleString()} tokens</>
                      )}
                    </Text>
                  </Box>
                  <IconChevronRight size={12} />
                </Group>
              </Paper>
            );
          })}
        </Stack>
      </ScrollArea>
    </Paper>
  );
}
