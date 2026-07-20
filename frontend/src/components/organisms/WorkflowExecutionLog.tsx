/**
 * Organism – WorkflowExecutionLog
 * --------------------------------
 * Per-step execution timeline for a workflow session. Shows the prompt,
 * response, variable diff, and full diagnostic log for each step.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  Paper,
  Text,
  Group,
  Badge,
  Code,
  Collapse,
  UnstyledButton,
  Loader,
  Center,
  Tabs,
  ScrollArea,
  Table,
  ThemeIcon,
  Alert,
  Divider,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconArrowNarrowDown,
  IconClock,
  IconCheck,
  IconAlertTriangle,
  IconActivity,
} from '@tabler/icons-react';
import * as api from '../../services/api';
import type { ChatMessage, DiagnosticLog, WorkflowStep } from '../../types/api';

interface Props {
  sessionId: string;
  steps: WorkflowStep[];
}

interface StepExecution {
  stepKey: string;
  stepName: string;
  sortOrder: number;
  userMessage: ChatMessage | null;
  assistantMessage: ChatMessage | null;
  diagnostic: DiagnosticLog | null;
  variablesBefore: Record<string, unknown>;
  variablesAfter: Record<string, unknown>;
  addedVars: Record<string, unknown>;
}

function statusColor(status: string): string {
  if (status === 'success') return 'green';
  if (status === 'error') return 'red';
  if (status === 'running') return 'blue';
  return 'gray';
}

function formatMs(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function WorkflowExecutionLog({ sessionId, steps }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [msgs, diagResult] = await Promise.all([
          api.getChatMessages(sessionId),
          api.listDiagnosticLogs({ chatSessionId: sessionId, limit: 100 }),
        ]);
        if (cancelled) return;
        setMessages(msgs);
        setDiagnostics(diagResult.data);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load execution data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const stepExecutions = useMemo((): StepExecution[] => {
    const sortedSteps = [...steps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const stepIdToKey = new Map<string, { key: string; name: string; order: number }>();
    sortedSteps.forEach((s, i) => {
      if (s.id) stepIdToKey.set(s.id, { key: s.step_key, name: s.name, order: s.sort_order ?? i });
    });

    const userMsgsByStep = new Map<string, ChatMessage>();
    const assistantMsgsByStep = new Map<string, ChatMessage>();
    const sortedMsgs = [...messages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    for (const msg of sortedMsgs) {
      if (msg.workflow_step_id && msg.role === 'user') {
        const stepInfo = stepIdToKey.get(msg.workflow_step_id);
        if (stepInfo) userMsgsByStep.set(stepInfo.key, msg);
      }
    }
    for (let i = 0; i < sortedMsgs.length; i++) {
      const msg = sortedMsgs[i];
      if (!msg) continue;
      if (msg.workflow_step_id && msg.role === 'user') {
        const stepInfo = stepIdToKey.get(msg.workflow_step_id);
        const nextMsg = sortedMsgs[i + 1];
        if (stepInfo && nextMsg && nextMsg.role === 'assistant') {
          assistantMsgsByStep.set(stepInfo.key, nextMsg);
        }
      }
    }

    const diagByStepKey = new Map<string, DiagnosticLog>();
    for (const d of diagnostics) {
      const payload = d.request_payload;
      if (payload && typeof payload.stepKey === 'string') {
        diagByStepKey.set(payload.stepKey, d);
      }
    }

    const executions: StepExecution[] = [];
    const accumulatedVars: Record<string, unknown> = {};

    for (const step of sortedSteps) {
      const variablesBefore = { ...accumulatedVars };
      const userMsg = userMsgsByStep.get(step.step_key) ?? null;
      const assistantMsg = assistantMsgsByStep.get(step.step_key) ?? null;
      const diag = diagByStepKey.get(step.step_key) ?? null;

      if (assistantMsg) {
        accumulatedVars[`${step.step_key}.prompt`] = userMsg?.content ?? '';
        accumulatedVars[`${step.step_key}.response`] = assistantMsg.content;
      }

      const variablesAfter = { ...accumulatedVars };
      const addedVars: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(variablesAfter)) {
        if (!(k in variablesBefore)) {
          addedVars[k] = v;
        }
      }

      executions.push({
        stepKey: step.step_key,
        stepName: step.name,
        sortOrder: step.sort_order ?? 0,
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        diagnostic: diag,
        variablesBefore,
        variablesAfter,
        addedVars,
      });
    }

    return executions;
  }, [steps, messages, diagnostics]);

  if (loading) {
    return (
      <Center p="md">
        <Loader size="sm" />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert color="red" title="Load Error">
        {error}
      </Alert>
    );
  }

  if (stepExecutions.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center">
        No step executions found for this session.
      </Text>
    );
  }

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <IconActivity size={16} opacity={0.6} />
        <Text fw={600} size="sm">
          Execution Timeline
        </Text>
        <Badge size="xs" variant="outline">
          {stepExecutions.filter((s) => s.assistantMessage).length} / {stepExecutions.length} steps
        </Badge>
      </Group>

      {stepExecutions.map((exec, idx) => {
        const isExpanded = expandedStep === exec.stepKey;
        const completed = !!exec.assistantMessage;
        const diagStatus = exec.diagnostic?.status || (completed ? 'success' : 'pending');
        const durationMs = exec.assistantMessage?.duration_ms ?? exec.diagnostic?.total_duration_ms;

        return (
          <Stack key={exec.stepKey} gap={0}>
            {idx > 0 && (
              <Center>
                <ThemeIcon variant="subtle" size="sm" color="gray">
                  <IconArrowNarrowDown size={16} />
                </ThemeIcon>
              </Center>
            )}
            <Paper p="sm" withBorder>
              <UnstyledButton onClick={() => setExpandedStep(isExpanded ? null : exec.stepKey)} w="100%">
                <Group justify="space-between">
                  <Group gap="xs">
                    {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    <Badge size="xs" color="gray" variant="filled">
                      {idx + 1}
                    </Badge>
                    <Text size="sm" fw={500}>
                      {exec.stepName}
                    </Text>
                    <Code style={{ fontSize: 11 }}>{exec.stepKey}</Code>
                  </Group>
                  <Group gap="xs">
                    <Badge
                      size="xs"
                      color={statusColor(diagStatus)}
                      leftSection={
                        diagStatus === 'success' ? (
                          <IconCheck size={10} />
                        ) : diagStatus === 'error' ? (
                          <IconAlertTriangle size={10} />
                        ) : undefined
                      }
                    >
                      {diagStatus}
                    </Badge>
                    {durationMs != null && (
                      <Badge size="xs" variant="light" color="gray" leftSection={<IconClock size={10} />}>
                        {formatMs(durationMs)}
                      </Badge>
                    )}
                    {Object.keys(exec.addedVars).length > 0 && (
                      <Badge size="xs" variant="light" color="teal">
                        +{Object.keys(exec.addedVars).length} vars
                      </Badge>
                    )}
                  </Group>
                </Group>
              </UnstyledButton>

              <Collapse in={isExpanded}>
                <Tabs defaultValue="prompt" mt="sm">
                  <Tabs.List>
                    <Tabs.Tab value="prompt">Prompt</Tabs.Tab>
                    <Tabs.Tab value="response">Response</Tabs.Tab>
                    <Tabs.Tab value="variables">Variables</Tabs.Tab>
                    <Tabs.Tab value="diagnostics">Diagnostics</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="prompt" pt="xs">
                    {exec.userMessage ? (
                      <ScrollArea mah={300}>
                        <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                          {exec.userMessage.content}
                        </Code>
                      </ScrollArea>
                    ) : (
                      <Text size="xs" c="dimmed">
                        Step has not been executed yet.
                      </Text>
                    )}
                  </Tabs.Panel>

                  <Tabs.Panel value="response" pt="xs">
                    {exec.assistantMessage ? (
                      <Stack gap="xs">
                        <ScrollArea mah={300}>
                          <Code block style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                            {exec.assistantMessage.content}
                          </Code>
                        </ScrollArea>
                        {(exec.assistantMessage.prompt_tokens || exec.assistantMessage.completion_tokens) && (
                          <Group gap="xs">
                            <Badge size="xs" variant="light">
                              {exec.assistantMessage.prompt_tokens ?? 0} prompt tokens
                            </Badge>
                            <Badge size="xs" variant="light">
                              {exec.assistantMessage.completion_tokens ?? 0} completion tokens
                            </Badge>
                          </Group>
                        )}
                      </Stack>
                    ) : (
                      <Text size="xs" c="dimmed">
                        No response recorded.
                      </Text>
                    )}
                  </Tabs.Panel>

                  <Tabs.Panel value="variables" pt="xs">
                    <VariableDiffView
                      before={exec.variablesBefore}
                      after={exec.variablesAfter}
                      added={exec.addedVars}
                    />
                  </Tabs.Panel>

                  <Tabs.Panel value="diagnostics" pt="xs">
                    <DiagnosticDetail diagnostic={exec.diagnostic} />
                  </Tabs.Panel>
                </Tabs>
              </Collapse>
            </Paper>
          </Stack>
        );
      })}
    </Stack>
  );
}

function VariableDiffView({
  before: _before,
  after,
  added,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  added: Record<string, unknown>;
}) {
  const allKeys = Object.keys(after);

  if (allKeys.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        No variables available at this point.
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {Object.keys(added).length > 0 && (
        <>
          <Text size="xs" fw={600}>
            Added in this step
          </Text>
          <ScrollArea>
            <Table withTableBorder style={{ fontSize: 12 }}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Variable</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(added).map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td>
                      <Code style={{ fontSize: 11 }}>{k}</Code>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" lineClamp={3} style={{ maxWidth: 400 }}>
                        {typeof v === 'string' ? v : JSON.stringify(v)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </>
      )}

      <Divider label="Full snapshot after step" labelPosition="center" />
      <ScrollArea>
        <Table withTableBorder style={{ fontSize: 12 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Variable</Table.Th>
              <Table.Th>Value</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allKeys.map((k) => {
              const isNew = k in added;
              return (
                <Table.Tr key={k}>
                  <Table.Td>
                    <Code style={{ fontSize: 11 }}>{k}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" lineClamp={2} style={{ maxWidth: 400 }}>
                      {typeof after[k] === 'string' ? after[k] : JSON.stringify(after[k])}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={isNew ? 'teal' : 'gray'}>
                      {isNew ? 'new' : 'inherited'}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}

function DiagnosticDetail({ diagnostic }: { diagnostic: DiagnosticLog | null }) {
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
