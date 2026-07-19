import { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  Button,
  Text,
  Badge,
  TextInput,
  Select,
  Textarea,
  Loader,
  Center,
  Alert,
  Paper,
  Grid,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconWand, IconEye, IconPlayerPlay } from '@tabler/icons-react';
import * as api from '../../../services/api';
import { interpolateTemplate } from '../../../lib/interpolate';
import type { ProcessingJob } from '../../../types/api';
import type { RuleSet, FormattingStepResult, TestResult } from './types';
import { getJobConfig } from './types';

/* ══════════════════════════════════════════════════════════════
   TEST RULE SET TAB  (chat-mode jobs only)
   Opens a real chat session, invokes the selected rule set with
   test data, streams the response, and displays it alongside
   metadata (duration, model, tokens).
   ══════════════════════════════════════════════════════════════ */

export default function TestRuleSetTab({
  selectedJob,
  selectedJobFull,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
}) {
  const [selectedRuleSetKey, setSelectedRuleSetKey] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [composedPrompt, setComposedPrompt] = useState('');
  const [testing, setTesting] = useState(false);
  const [streamedContent, setStreamedContent] = useState('');
  const [metadata, setMetadata] = useState<{
    durationMs?: number;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    finishReason?: string;
    formattingSteps?: FormattingStepResult[];
  } | null>(null);

  /* When job or selected rule set changes, initialise variable state */
  const ruleSets = getJobConfig(selectedJobFull).ruleSets || [];
  const activeRuleSet = ruleSets.find((rs) => rs.key === selectedRuleSetKey) || null;

  useEffect(() => {
    if (!activeRuleSet) {
      setVariables({});
      setComposedPrompt('');
      return;
    }
    const vars: Record<string, string> = {};
    for (const v of activeRuleSet.variables || []) {
      vars[v.name] = activeRuleSet.testData?.[v.name] || '';
    }
    setVariables(vars);
    const { text } = interpolateTemplate(activeRuleSet.promptTemplate || '', vars);
    setComposedPrompt(text);
  }, [selectedRuleSetKey, activeRuleSet]);

  function composePrompt(vars: Record<string, string>, rs: RuleSet | null) {
    const { text } = interpolateTemplate(rs?.promptTemplate || '', vars || {});
    setComposedPrompt(text);
  }

  function handleVarChange(name: string, value: string) {
    const updated = { ...variables, [name]: value };
    setVariables(updated);
    composePrompt(updated, activeRuleSet);
  }

  function loadTestData() {
    if (!activeRuleSet) return;
    const filled: Record<string, string> = {};
    for (const v of activeRuleSet.variables || []) {
      filled[v.name] = activeRuleSet.testData?.[v.name] || `[No test data for ${v.label || v.name}]`;
    }
    setVariables(filled);
    composePrompt(filled, activeRuleSet);
  }

  async function runTest() {
    if (!activeRuleSet || !composedPrompt.trim()) return;
    try {
      setTesting(true);
      setStreamedContent('');
      setMetadata(null);

      /* Use the existing processing-job test endpoint with a promptOverride.
         This calls the same AI profile (completion path) so we can preview
         the formatted response without needing a live chat session from the test UI. */
      if (!selectedJob) return;
      const data = (await api.testProcessingJob(selectedJob, variables, composedPrompt)) as TestResult;
      setStreamedContent(data.formatted || data.raw || '');
      setMetadata({
        durationMs: data.durationMs,
        model: data.model,
        usage: data.usage,
        finishReason: data.finishReason,
        formattingSteps: data.formattingSteps,
      });
    } catch (err: unknown) {
      notifications.show({
        title: 'Test Failed',
        message: err instanceof Error ? err.message : String(err),
        color: 'red',
      });
    } finally {
      setTesting(false);
    }
  }

  if (!selectedJob)
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab first.
      </Alert>
    );
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  if (ruleSets.length === 0) {
    return (
      <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={14} />}>
        No rule sets configured. Go to the <strong>Rule Sets</strong> tab to add some.
      </Alert>
    );
  }

  const ruleSetOptions = ruleSets.map((rs) => ({ value: rs.key, label: `${rs.name || rs.key} (${rs.key})` }));

  return (
    <Stack gap="md">
      <Title order={4}>Test Rule Set — {selectedJobFull.name}</Title>

      <Select
        label="Rule Set"
        placeholder="Select a rule set to test"
        data={ruleSetOptions}
        value={selectedRuleSetKey}
        onChange={setSelectedRuleSetKey}
      />

      {activeRuleSet && (
        <>
          {/* ── Variables ── */}
          <Paper withBorder p="md">
            <Group justify="space-between" mb={8}>
              <Text fw={600} size="sm">
                Variable Values
              </Text>
              <Group gap="xs">
                <Button size="xs" variant="light" leftSection={<IconWand size={14} />} onClick={loadTestData}>
                  Load Test Data
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  leftSection={<IconEye size={14} />}
                  onClick={() => composePrompt(variables, activeRuleSet)}
                >
                  Compose Prompt
                </Button>
              </Group>
            </Group>
            {(activeRuleSet.variables || []).length === 0 ? (
              <Text size="xs" c="dimmed">
                This rule set has no variables.
              </Text>
            ) : (
              <Grid>
                {(activeRuleSet.variables || []).map((v) => (
                  <Grid.Col span={v.source === 'user' ? 6 : 12} key={v.name}>
                    {v.source === 'user' ? (
                      <TextInput
                        label={
                          <Group gap={4}>
                            <Text size="xs" fw={500}>
                              {v.label || v.name}
                            </Text>
                            <Badge size="xs" color="blue">
                              user
                            </Badge>
                          </Group>
                        }
                        value={variables[v.name] || ''}
                        onChange={(e) => handleVarChange(v.name, e.target.value)}
                      />
                    ) : (
                      <Textarea
                        label={
                          <Group gap={4}>
                            <Text size="xs" fw={500}>
                              {v.label || v.name}
                            </Text>
                            <Badge size="xs" variant="outline" color="gray">
                              pipeline
                            </Badge>
                          </Group>
                        }
                        value={variables[v.name] || ''}
                        onChange={(e) => handleVarChange(v.name, e.target.value)}
                        autosize
                        minRows={2}
                        maxRows={6}
                        styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                      />
                    )}
                  </Grid.Col>
                ))}
              </Grid>
            )}
          </Paper>

          {/* ── Composed Prompt ── */}
          <Paper withBorder p="md">
            <Group justify="space-between" mb={8}>
              <Text fw={600} size="sm">
                Message Sent to LLM
              </Text>
              <Group gap="xs">
                <Badge variant="light" size="sm">
                  {composedPrompt.length} chars
                </Badge>
                <Button
                  size="xs"
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={runTest}
                  loading={testing}
                  disabled={!composedPrompt.trim()}
                >
                  Run Test
                </Button>
              </Group>
            </Group>
            <Textarea
              value={composedPrompt}
              onChange={(e) => setComposedPrompt(e.target.value)}
              autosize
              minRows={6}
              maxRows={25}
              styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
            />
          </Paper>

          {/* ── Result ── */}
          {(streamedContent || metadata) && (
            <Stack gap="md">
              {metadata && (
                <Paper withBorder p="sm">
                  <Group gap="lg" wrap="wrap">
                    {metadata.durationMs && (
                      <Badge color="blue" variant="light">
                        Duration: {metadata.durationMs}ms
                      </Badge>
                    )}
                    {metadata.model && (
                      <Badge color="gray" variant="light">
                        Model: {metadata.model}
                      </Badge>
                    )}
                    {metadata.usage && (
                      <>
                        <Badge color="gray" variant="light">
                          Prompt tokens: {metadata.usage.prompt_tokens}
                        </Badge>
                        <Badge color="gray" variant="light">
                          Completion tokens: {metadata.usage.completion_tokens}
                        </Badge>
                      </>
                    )}
                    {metadata.finishReason && (
                      <Badge color="gray" variant="light">
                        Finish: {metadata.finishReason}
                      </Badge>
                    )}
                    {activeRuleSet.key && (
                      <Badge color="violet" variant="light">
                        Rule set: {activeRuleSet.key}
                      </Badge>
                    )}
                  </Group>
                </Paper>
              )}
              <Paper withBorder p="md">
                <Text fw={600} size="sm" mb={8}>
                  AI Response
                </Text>
                <Textarea
                  value={streamedContent}
                  readOnly
                  autosize
                  minRows={6}
                  maxRows={40}
                  styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
                />
              </Paper>
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}
