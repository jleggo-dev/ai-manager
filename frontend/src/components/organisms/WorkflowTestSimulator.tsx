/**
 * Organism – WorkflowTestSimulator
 * ----------------------------------
 * Dry-run and live-run test harness for workflows. Uses each step's
 * processing job testData to preview interpolated prompts (dry run)
 * or execute against the real LLM (live run).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Stack,
  Paper,
  Text,
  Group,
  Badge,
  Button,
  Code,
  TextInput,
  Loader,
  Center,
  Divider,
  Collapse,
  UnstyledButton,
  SegmentedControl,
  ScrollArea,
  Alert,
  Textarea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconChevronDown,
  IconChevronRight,
  IconPlayerPlay,
  IconRefresh,
  IconCheck,
  IconAlertTriangle,
  IconClock,
} from '@tabler/icons-react';
import * as api from '../../services/api';
import { resolveApiUrl } from '../../lib/api-url';
import type { ProcessingJob, ProcessingJobConfig, Workflow, WorkflowStepConfig } from '../../types/api';
import { interpolateTemplate, extractPlaceholders, applyInputMappings } from '../../lib/interpolate';

interface WorkflowStepInfo {
  id?: string;
  step_key: string;
  name: string;
  processing_job_id: string;
  sort_order?: number;
  depends_on?: string[];
  config?: WorkflowStepConfig;
  processing_job?: ProcessingJob | null;
}

interface Props {
  workflow: Workflow & { steps?: WorkflowStepInfo[] };
  onClose?: () => void;
}

interface StepState {
  stepKey: string;
  stepName: string;
  jobName: string;
  template: string;
  variables: Record<string, string>;
  placeholders: string[];
  interpolated: string;
  missingKeys: string[];
  inputMappings: Record<string, string>;
  outputMappings: Record<string, string>;
  accumulatedAfter: Record<string, string>;
  status: 'pending' | 'ready' | 'running' | 'done' | 'error';
  response?: string;
  error?: string;
  durationMs?: number;
  tokenUsage?: { prompt?: number; completion?: number };
}

export default function WorkflowTestSimulator({ workflow, onClose }: Props) {
  const [mode, setMode] = useState<'dry' | 'live'>('dry');
  const [stepStates, setStepStates] = useState<StepState[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const loadStepData = useCallback(async () => {
    setLoading(true);
    const sorted = [...(workflow.steps || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    const jobIds = [...new Set(sorted.filter((s) => s.processing_job_id).map((s) => s.processing_job_id))];
    const jobMap = new Map<string, ProcessingJob>();
    await Promise.all(
      jobIds.map(async (id) => {
        try {
          const job = await api.getProcessingJob(id);
          jobMap.set(id, job);
        } catch {
          /* job may have been deleted */
        }
      }),
    );

    const accumulated: Record<string, string> = {};
    const states: StepState[] = sorted.map((s) => {
      const job = s.processing_job ?? jobMap.get(s.processing_job_id) ?? null;
      const config = (job?.config ?? {}) as ProcessingJobConfig;
      const stepConfig = (s.config ?? {}) as WorkflowStepConfig;
      const template = (stepConfig.promptTemplate as string | undefined) ?? config.promptTemplate ?? '';
      const placeholders = extractPlaceholders(template);
      const testData = config.testData ?? {};
      const iMappings = stepConfig.inputMappings ?? {};
      const oMappings = stepConfig.outputMappings ?? {};

      const mappedVars = applyInputMappings(iMappings, accumulated, {});
      const vars: Record<string, string> = {};
      placeholders.forEach((k) => {
        vars[k] = mappedVars[k] ?? testData[k] ?? '';
      });

      const result = interpolateTemplate(template, vars);

      const outputFields = Object.keys(config.expectedSchema?.fields ?? {});
      for (const field of outputFields) {
        const wfVar = oMappings[field];
        if (wfVar && testData[field]) {
          accumulated[wfVar] = testData[field];
        }
      }

      return {
        stepKey: s.step_key,
        stepName: s.name,
        jobName: job?.name ?? '(unknown)',
        template,
        variables: vars,
        placeholders,
        interpolated: result.text,
        missingKeys: result.missingKeys,
        inputMappings: iMappings,
        outputMappings: oMappings,
        accumulatedAfter: { ...accumulated },
        status: 'ready' as const,
      };
    });

    setStepStates(states);
    setExpandedStep(states[0]?.stepKey ?? null);
    setLoading(false);
  }, [workflow.steps]);

  useEffect(() => {
    loadStepData();
  }, [loadStepData]);

  function updateVariable(stepKey: string, varName: string, value: string) {
    setStepStates((prev) =>
      prev.map((s) => {
        if (s.stepKey !== stepKey) return s;
        const newVars = { ...s.variables, [varName]: value };
        const result = interpolateTemplate(s.template, newVars);
        return { ...s, variables: newVars, interpolated: result.text, missingKeys: result.missingKeys };
      }),
    );
  }

  function resetAll() {
    setSessionId(null);
    setRunning(false);
    loadStepData();
  }

  async function runLive() {
    if (running) return;
    setRunning(true);

    try {
      const sessionRes = await api.createChatSession({
        aiProfileId: workflow.ai_profile_id ?? undefined,
        userId: '00000000-0000-0000-0000-000000000000',
        callingApplication: 'ai-admin:workflow-test',
      });

      const sid = sessionRes.sessionId ?? sessionRes.id;
      setSessionId(sid);

      for (let i = 0; i < stepStates.length; i++) {
        const step = stepStates[i];
        if (!step) continue;

        setStepStates((prev) => prev.map((s, idx) => (idx === i ? { ...s, status: 'running' } : s)));
        setExpandedStep(step.stepKey);

        const startTime = Date.now();
        try {
          const res = await fetch(resolveApiUrl(`/api/chat-sessions/${sid}/messages`), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeaders(),
            },
            body: JSON.stringify({
              stepKey: step.stepKey,
              variables: step.variables,
            }),
          });

          if (!res.ok) {
            const errBody = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(errBody.error || `HTTP ${res.status}`);
          }

          let fullText = '';
          if (res.headers.get('content-type')?.includes('text/event-stream')) {
            const reader = res.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
              let done = false;
              while (!done) {
                const { value, done: d } = await reader.read();
                done = d;
                if (value) {
                  const chunk = decoder.decode(value, { stream: true });
                  const lines = chunk.split('\n');
                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      const payload = line.slice(6).trim();
                      if (payload === '[DONE]') continue;
                      try {
                        const parsed = JSON.parse(payload);
                        if (parsed.content) fullText += parsed.content;
                        else if (parsed.formatted) fullText = parsed.formatted;
                        else if (parsed.raw) fullText = parsed.raw;
                      } catch {
                        /* non-JSON data line */
                      }
                    }
                  }
                }
              }
            }
          } else {
            const body = await res.json();
            fullText = body.formatted || body.raw || body.content || JSON.stringify(body);
          }

          const elapsed = Date.now() - startTime;
          setStepStates((prev) =>
            prev.map((s, idx) => (idx === i ? { ...s, status: 'done', response: fullText, durationMs: elapsed } : s)),
          );
        } catch (err) {
          setStepStates((prev) =>
            prev.map((s, idx) =>
              idx === i ? { ...s, status: 'error', error: err instanceof Error ? err.message : String(err) } : s,
            ),
          );
          break;
        }
      }
    } catch (err) {
      notifications.show({
        title: 'Session failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <Center p="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="sm">
          <Text fw={600}>Test: {workflow.name}</Text>
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as 'dry' | 'live')}
            data={[
              { label: 'Dry Run', value: 'dry' },
              { label: 'Live Run', value: 'live' },
            ]}
          />
        </Group>
        <Group gap="xs">
          <Button variant="light" size="xs" leftSection={<IconRefresh size={14} />} onClick={resetAll}>
            Reset
          </Button>
          {onClose && (
            <Button variant="default" size="xs" onClick={onClose}>
              Close
            </Button>
          )}
        </Group>
      </Group>

      {mode === 'live' && (
        <Alert variant="light" color="blue" icon={<IconAlertTriangle size={16} />}>
          <Text size="xs">
            Live Run calls the real LLM and uses tokens. The test session uses{' '}
            <Code>callingApplication: &quot;ai-admin:workflow-test&quot;</Code>.
          </Text>
        </Alert>
      )}

      {stepStates.map((step, idx) => {
        const isExpanded = expandedStep === step.stepKey;
        const statusIcon =
          step.status === 'done' ? (
            <IconCheck size={16} color="green" />
          ) : step.status === 'running' ? (
            <Loader size={14} />
          ) : step.status === 'error' ? (
            <IconAlertTriangle size={16} color="red" />
          ) : (
            <IconClock size={14} opacity={0.4} />
          );

        return (
          <Paper key={step.stepKey} p="sm" withBorder>
            <UnstyledButton onClick={() => setExpandedStep(isExpanded ? null : step.stepKey)} w="100%">
              <Group justify="space-between">
                <Group gap="xs">
                  {statusIcon}
                  <Text size="sm" fw={500}>
                    {idx + 1}. {step.stepName}
                  </Text>
                  <Code style={{ fontSize: 11 }}>{step.stepKey}</Code>
                </Group>
                <Group gap="xs">
                  <Text size="xs" c="dimmed">
                    {step.jobName}
                  </Text>
                  {step.missingKeys.length > 0 && (
                    <Badge size="xs" color="orange">
                      {step.missingKeys.length} missing
                    </Badge>
                  )}
                  {step.durationMs !== undefined && (
                    <Badge size="xs" variant="light">
                      {(step.durationMs / 1000).toFixed(1)}s
                    </Badge>
                  )}
                  {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                </Group>
              </Group>
            </UnstyledButton>

            <Collapse in={isExpanded}>
              <Stack gap="xs" mt="sm">
                <Text size="xs" fw={600}>
                  Input Variables
                </Text>
                {step.placeholders.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    No variables in this step&apos;s template.
                  </Text>
                ) : (
                  <Group gap="xs" wrap="wrap">
                    {step.placeholders.map((key) => (
                      <TextInput
                        key={key}
                        label={key}
                        size="xs"
                        value={step.variables[key] ?? ''}
                        onChange={(e) => updateVariable(step.stepKey, key, e.target.value)}
                        placeholder="(no test data)"
                        style={{ flex: '1 1 180px', maxWidth: 300 }}
                        error={!step.variables[key] ? 'No test data' : undefined}
                        disabled={running}
                      />
                    ))}
                  </Group>
                )}

                <Divider />

                <Text size="xs" fw={600}>
                  Interpolated Prompt
                </Text>
                <ScrollArea.Autosize mah={200}>
                  <Paper
                    p="xs"
                    withBorder
                    style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}
                  >
                    {step.interpolated || '(empty template)'}
                  </Paper>
                </ScrollArea.Autosize>

                {step.response && (
                  <>
                    <Divider />
                    <Text size="xs" fw={600}>
                      LLM Response
                    </Text>
                    <ScrollArea.Autosize mah={300}>
                      <Textarea
                        value={step.response}
                        readOnly
                        autosize
                        minRows={3}
                        maxRows={12}
                        styles={{ input: { fontSize: 12, fontFamily: 'monospace' } }}
                      />
                    </ScrollArea.Autosize>
                  </>
                )}

                {step.error && (
                  <Alert color="red" variant="light">
                    <Text size="xs">{step.error}</Text>
                  </Alert>
                )}

                {Object.keys(step.accumulatedAfter).length > 0 && (
                  <>
                    <Divider />
                    <Text size="xs" fw={600}>
                      Accumulated Variables After This Step
                    </Text>
                    <Group gap="xs" wrap="wrap">
                      {Object.entries(step.accumulatedAfter).map(([k, v]) => (
                        <Badge key={k} size="xs" variant="light" color="green">
                          {k}: {String(v).slice(0, 40)}
                          {String(v).length > 40 ? '...' : ''}
                        </Badge>
                      ))}
                    </Group>
                  </>
                )}
              </Stack>
            </Collapse>
          </Paper>
        );
      })}

      <Group justify="center">
        {mode === 'live' ? (
          <Button
            leftSection={<IconPlayerPlay size={16} />}
            onClick={runLive}
            loading={running}
            disabled={stepStates.length === 0}
          >
            Run All Steps
          </Button>
        ) : (
          <Text size="sm" c="dimmed">
            Dry run — edit variables above to see prompts update in real-time.
            {sessionId && ` (Session: ${sessionId.slice(0, 8)}…)`}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const stored = localStorage.getItem('supabase.auth.token');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      const token = parsed?.currentSession?.access_token;
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {
      /* ignore */
    }
  }
  return headers;
}
