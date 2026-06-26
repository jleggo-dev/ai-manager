import { useState, useEffect, useCallback } from 'react';
import useConfirm from '../../hooks/useConfirm';
import {
  Stack,
  Group,
  Button,
  Text,
  Badge,
  ActionIcon,
  Tooltip,
  Alert,
  Code,
  Paper,
  Grid,
  ScrollArea,
  Box,
  Loader,
  Center,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronRight, IconX, IconAlertTriangle, IconCircleX, IconRefresh } from '@tabler/icons-react';
import * as api from '../../services/api';
import type { ProcessingJob } from '../../types/api';

interface SupabaseTimingOp {
  durationMs: number;
  operation: string;
  success: boolean;
  error?: string;
}

interface DiagnosticLogEntry {
  id: string;
  status: string;
  calling_application?: string;
  created_at: string;
  total_duration_ms?: number;
  error_message?: string | null;
  metadata?: {
    failoverUsed?: string | boolean;
    primaryModel?: string;
    failoverModel?: string;
    failoverProviderName?: string;
    failoverProviderType?: string;
    primaryModelError?: string;
  };
  supabase_timing?: SupabaseTimingOp[];
  llm_timing?: {
    durationMs: number;
    model: string;
    provider: string;
  };
  llm_request?: {
    promptContent?: string;
    promptLength?: number;
    model?: string;
    provider?: string;
  };
  llm_response?: {
    rawContent?: string;
    rawLength?: number;
    finishReason?: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  formatting_timing?: {
    durationMs: number;
    rulesApplied: number;
  };
  request_payload?: Record<string, unknown>;
}

interface DiagnosticsConfig {
  enabled?: boolean;
  mode?: string;
}

interface DiagnosticsTabProps {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
}

export default function DiagnosticsTab({ selectedJob, selectedJobFull }: DiagnosticsTabProps) {
  const confirm = useConfirm();
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<DiagnosticLogEntry | null>(null);

  const loadLogs = useCallback(async () => {
    if (!selectedJob) return;
    try {
      setLoading(true);
      const result = await api.listDiagnosticLogs({ processingJobId: selectedJob, limit: 50 });
      setLogs(result.data as unknown as DiagnosticLogEntry[]);
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, [selectedJob]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  if (!selectedJob) {
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab to view its diagnostic logs.
      </Alert>
    );
  }
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const advanced = selectedJobFull.config?.['advanced'] as { diagnostics?: DiagnosticsConfig } | undefined;
  const diagConfig = advanced?.diagnostics;
  const diagEnabled = diagConfig?.enabled;

  async function handleClearLogs() {
    if (
      !(await confirm({
        title: 'Delete diagnostic logs',
        message: "All diagnostic logs for this job will be permanently removed. This can't be undone.",
      }))
    )
      return;
    try {
      if (!selectedJob) return;
      await api.clearDiagnosticLogs(selectedJob);
      setLogs([]);
      setSelectedLog(null);
      notifications.show({ title: 'Cleared', message: 'Diagnostic logs removed', color: 'orange' });
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={4}>{selectedJobFull.name} — Diagnostic Logs</Title>
        <Group gap="xs">
          <Badge color={diagEnabled ? 'green' : 'gray'} variant="light" size="sm">
            Diagnostics: {diagEnabled ? `${diagConfig.mode}` : 'Off'}
          </Badge>
          <Tooltip label="Refresh logs">
            <ActionIcon variant="subtle" onClick={loadLogs} loading={loading}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          {logs.length > 0 && (
            <Button size="xs" variant="light" color="red" onClick={handleClearLogs}>
              Clear All Logs
            </Button>
          )}
        </Group>
      </Group>

      {!diagEnabled && (
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={16} />}>
          Diagnostics are currently disabled for this job. Enable them in the Advanced tab to start logging.
        </Alert>
      )}

      {loading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : logs.length === 0 ? (
        <Alert variant="light" color="gray">
          No diagnostic logs found.{' '}
          {diagEnabled ? 'Run the processing job to generate logs.' : 'Enable diagnostics in the Advanced tab first.'}
        </Alert>
      ) : (
        <Grid>
          <Grid.Col span={selectedLog ? 4 : 12}>
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
                        onClick={() => setSelectedLog(log)}
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
          </Grid.Col>

          {selectedLog && (
            <Grid.Col span={8}>
              <Paper withBorder p="sm">
                <Group justify="space-between" mb="sm">
                  <Text fw={600} size="sm">
                    Log Detail
                  </Text>
                  <ActionIcon variant="subtle" onClick={() => setSelectedLog(null)}>
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
                        <Badge color={selectedLog.status === 'success' ? 'green' : 'red'} size="sm">
                          {selectedLog.status}
                        </Badge>
                      </Box>
                      <Box>
                        <Text size="xs" c="dimmed">
                          Duration
                        </Text>
                        <Text size="xs" fw={500}>
                          {selectedLog.total_duration_ms}ms
                        </Text>
                      </Box>
                      <Box>
                        <Text size="xs" c="dimmed">
                          Calling App
                        </Text>
                        <Text size="xs" fw={500}>
                          {selectedLog.calling_application}
                        </Text>
                      </Box>
                      <Box>
                        <Text size="xs" c="dimmed">
                          Timestamp
                        </Text>
                        <Text size="xs">{new Date(selectedLog.created_at).toLocaleString()}</Text>
                      </Box>
                    </Group>
                  </Paper>

                  {selectedLog.error_message && (
                    <Alert color="red" variant="light" icon={<IconCircleX size={14} />}>
                      <Text size="xs">{selectedLog.error_message}</Text>
                    </Alert>
                  )}

                  {selectedLog.supabase_timing && (
                    <Paper withBorder p="xs">
                      <Text size="xs" fw={600} mb={4}>
                        Supabase Operations
                      </Text>
                      {(Array.isArray(selectedLog.supabase_timing) ? selectedLog.supabase_timing : []).map(
                        (op: SupabaseTimingOp, i: number) => (
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

                  {selectedLog.llm_timing && (
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
                            {selectedLog.llm_timing.durationMs}ms
                          </Text>
                        </Box>
                        <Box>
                          <Text size="xs" c="dimmed">
                            Model
                          </Text>
                          <Text size="xs">{selectedLog.llm_timing.model}</Text>
                        </Box>
                        <Box>
                          <Text size="xs" c="dimmed">
                            Provider
                          </Text>
                          <Text size="xs">{selectedLog.llm_timing.provider}</Text>
                        </Box>
                      </Group>
                      {selectedLog.llm_response?.usage ? (
                        <Group gap="lg" mt={4} wrap="wrap">
                          <Box>
                            <Text size="xs" c="dimmed">
                              Prompt Tokens
                            </Text>
                            <Text size="xs" fw={500}>
                              {(selectedLog.llm_response.usage.prompt_tokens ?? 0).toLocaleString()}
                            </Text>
                          </Box>
                          <Box>
                            <Text size="xs" c="dimmed">
                              Completion Tokens
                            </Text>
                            <Text size="xs" fw={500}>
                              {(selectedLog.llm_response.usage.completion_tokens ?? 0).toLocaleString()}
                            </Text>
                          </Box>
                          <Box>
                            <Text size="xs" c="dimmed">
                              Total Tokens
                            </Text>
                            <Text size="xs" fw={600} c="blue">
                              {(selectedLog.llm_response.usage.total_tokens ?? 0).toLocaleString()}
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

                  {selectedLog.metadata &&
                    (() => {
                      const fo = String(selectedLog.metadata.failoverUsed) === 'true';
                      return (
                        <Paper
                          withBorder
                          p="xs"
                          style={
                            fo
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
                              <Text size="xs">{selectedLog.metadata.primaryModel || '—'}</Text>
                            </Box>
                            <Box>
                              <Text size="xs" c="dimmed">
                                Failover Model
                              </Text>
                              <Text size="xs">{selectedLog.metadata.failoverModel || '—'}</Text>
                            </Box>
                            {selectedLog.metadata.failoverProviderName && (
                              <Box>
                                <Text size="xs" c="dimmed">
                                  Failover Provider
                                </Text>
                                <Text size="xs">
                                  {selectedLog.metadata.failoverProviderName} (
                                  {selectedLog.metadata.failoverProviderType || '?'})
                                </Text>
                              </Box>
                            )}
                            <Box>
                              <Text size="xs" c="dimmed">
                                Failover Used
                              </Text>
                              <Badge size="xs" color={fo ? 'orange' : 'gray'} variant={fo ? 'filled' : 'light'}>
                                {fo ? 'Yes — Failover Triggered' : 'No'}
                              </Badge>
                            </Box>
                          </Group>
                          {selectedLog.metadata.primaryModelError && (
                            <Alert mt="xs" variant="light" color="orange">
                              <Text size="xs" fw={500}>
                                Primary Error:
                              </Text>
                              <Text size="xs">{selectedLog.metadata.primaryModelError}</Text>
                            </Alert>
                          )}
                        </Paper>
                      );
                    })()}

                  {selectedLog.formatting_timing && (
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
                            {selectedLog.formatting_timing.durationMs}ms
                          </Text>
                        </Box>
                        <Box>
                          <Text size="xs" c="dimmed">
                            Rules Applied
                          </Text>
                          <Text size="xs">{selectedLog.formatting_timing.rulesApplied}</Text>
                        </Box>
                      </Group>
                    </Paper>
                  )}

                  {selectedLog.request_payload && (
                    <Paper withBorder p="xs">
                      <Text size="xs" fw={600} mb={4}>
                        Request Payload
                      </Text>
                      <ScrollArea h={250}>
                        <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(selectedLog.request_payload, null, 2)}
                        </Code>
                      </ScrollArea>
                    </Paper>
                  )}

                  {selectedLog.llm_request && (
                    <Paper withBorder p="xs">
                      <Text size="xs" fw={600} mb={4}>
                        Prompt Sent to LLM
                      </Text>
                      {selectedLog.llm_request.promptContent ? (
                        <ScrollArea h={300}>
                          <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                            {selectedLog.llm_request.promptContent}
                          </Code>
                        </ScrollArea>
                      ) : (
                        <ScrollArea h={200}>
                          <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(selectedLog.llm_request, null, 2)}
                          </Code>
                        </ScrollArea>
                      )}
                      {selectedLog.llm_request.promptLength && (
                        <Text size="xs" c="dimmed" mt={4}>
                          {selectedLog.llm_request.promptLength.toLocaleString()} characters
                          {selectedLog.llm_request.model ? ` • Model: ${selectedLog.llm_request.model}` : ''}
                          {selectedLog.llm_request.provider ? ` • Provider: ${selectedLog.llm_request.provider}` : ''}
                        </Text>
                      )}
                    </Paper>
                  )}

                  {selectedLog.llm_response && (
                    <Paper withBorder p="xs">
                      <Text size="xs" fw={600} mb={4}>
                        LLM Response
                      </Text>
                      {selectedLog.llm_response.rawContent ? (
                        <ScrollArea h={300}>
                          <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                            {selectedLog.llm_response.rawContent}
                          </Code>
                        </ScrollArea>
                      ) : (
                        <ScrollArea h={200}>
                          <Code block style={{ fontSize: 10, whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(selectedLog.llm_response, null, 2)}
                          </Code>
                        </ScrollArea>
                      )}
                      {(selectedLog.llm_response.usage || selectedLog.llm_response.finishReason) && (
                        <Group gap="lg" mt={4}>
                          {selectedLog.llm_response.usage && (
                            <Text size="xs" c="dimmed">
                              Tokens — prompt: {selectedLog.llm_response.usage.prompt_tokens?.toLocaleString()},
                              completion: {selectedLog.llm_response.usage.completion_tokens?.toLocaleString()}, total:{' '}
                              {selectedLog.llm_response.usage.total_tokens?.toLocaleString()}
                            </Text>
                          )}
                          {selectedLog.llm_response.finishReason && (
                            <Text size="xs" c="dimmed">
                              Finish: {selectedLog.llm_response.finishReason}
                            </Text>
                          )}
                          {selectedLog.llm_response.rawLength && (
                            <Text size="xs" c="dimmed">
                              {selectedLog.llm_response.rawLength.toLocaleString()} chars
                            </Text>
                          )}
                        </Group>
                      )}
                    </Paper>
                  )}
                </Stack>
              </Paper>
            </Grid.Col>
          )}
        </Grid>
      )}
    </Stack>
  );
}
