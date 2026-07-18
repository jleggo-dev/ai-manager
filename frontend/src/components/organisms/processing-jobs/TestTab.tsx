import { useState, useEffect } from 'react';
import {
  Stack,
  Group,
  Button,
  Text,
  Badge,
  TextInput,
  Textarea,
  Loader,
  Center,
  Alert,
  Code,
  Paper,
  Grid,
  ScrollArea,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconWand, IconEye, IconPlayerPlay, IconAlertTriangle } from '@tabler/icons-react';
import * as api from '../../../services/api';
import type { ProcessingJob } from '../../../types/api';
import type { TestResult, FormattingStepResult } from './types';
import { getJobConfig } from './types';
import SchemaValidationPanel from './SchemaValidationPanel';

/* ══════════════════════════════════════════════════════════════
   TEST TAB — Full end-to-end test with 3 panels
   ══════════════════════════════════════════════════════════════ */

/**
 * Default sample values for the Test tab live in config.testData.
 * Configure them under Jobs → Build Rules (Default test values) or via
 * PUT /api/processing-jobs/:id (config.testData).
 *
 * config.testData example:
 * {
 *   companyName: 'HubSpot',
 *   domain: 'hubspot.com',
 *   websiteHomepage: '...',
 *   ...
 * }
 */

export default function TestTab({
  selectedJob,
  selectedJobFull,
  onSelect: _onSelect,
}: {
  selectedJob: string | null;
  selectedJobFull: ProcessingJob | null;
  onSelect?: (id: string) => void;
}) {
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [composedPrompt, setComposedPrompt] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  /* Initialise all variables (user + pipeline) when job changes */
  useEffect(() => {
    if (!selectedJobFull) {
      setVariables({});
      setComposedPrompt('');
      setResult(null);
      return;
    }
    const vars: Record<string, string> = {};
    for (const v of getJobConfig(selectedJobFull).variables || []) {
      vars[v.name] = '';
    }
    setVariables(vars);
    setComposedPrompt('');
    setResult(null);
  }, [selectedJobFull]);

  if (!selectedJob) {
    return (
      <Alert variant="light" color="blue">
        Select a job from the Jobs tab first, then test it here.
      </Alert>
    );
  }
  if (!selectedJobFull)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );

  const allVars = getJobConfig(selectedJobFull).variables || [];
  const promptTemplate = getJobConfig(selectedJobFull).promptTemplate || '';
  const testData = getJobConfig(selectedJobFull).testData || {};
  const hasTestData = Object.keys(testData).length > 0;

  /** Fill inputs from config.testData (Build Rules or API). */
  function generateTestValues() {
    const filled: Record<string, string> = {};
    for (const v of allVars) {
      filled[v.name] = testData[v.name] || `[No test data for ${v.label}]`;
    }
    setVariables(filled);
    /* Also compose the prompt immediately */
    composePromptFromVars(filled);
  }

  /** Build the composed prompt from the template + current variable values */
  function composePromptFromVars(vars: Record<string, string>) {
    let composed = promptTemplate;
    for (const [key, val] of Object.entries(vars || variables)) {
      composed = composed.split(`{{${key}}}`).join(val || `{{${key}}}`);
    }
    setComposedPrompt(composed);
  }

  /** Update a variable and recompose the prompt */
  function handleVarChange(name: string, value: string) {
    const updated = { ...variables, [name]: value };
    setVariables(updated);
    composePromptFromVars(updated);
  }

  /** Compose the prompt from current vars (explicit button) */
  function handleCompose() {
    composePromptFromVars(variables);
  }

  /** Run the test — send the composed prompt to the LLM */
  async function runTest() {
    try {
      setTesting(true);
      setResult(null);
      /* Send the composed prompt directly (admin may have edited it) */
      if (!selectedJob) return;
      const data = await api.testProcessingJob(selectedJob, variables, composedPrompt);
      setResult(data);
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

  return (
    <Stack gap="md">
      <Title order={4}>Test: {selectedJobFull.name}</Title>

      {/* ── Variable Inputs ───────────────────── */}
      <Paper withBorder p="md">
        <Group justify="space-between" mb={8}>
          <Text fw={600} size="sm">
            Variable Values
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="light" leftSection={<IconWand size={14} />} onClick={generateTestValues}>
              Generate Test Values
            </Button>
            <Button size="xs" variant="outline" leftSection={<IconEye size={14} />} onClick={handleCompose}>
              Compose Prompt
            </Button>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" mb={hasTestData ? 12 : 4}>
          Enter values for all variables, or click &quot;Generate Test Values&quot; to use defaults from Build Rules or
          config.testData.
        </Text>
        {!hasTestData && (
          <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={14} />} mb={12}>
            <Text size="xs">
              No test data configured. Set <strong>Default test values</strong> in <strong>Build Rules</strong>, or
              provide <Code>config.testData</Code> via <Code>PUT /api/processing-jobs/:id</Code>. You can still enter
              values manually.
            </Text>
          </Alert>
        )}

        <Grid>
          {allVars.map((v) => (
            <Grid.Col span={v.source === 'user' ? 6 : 12} key={v.name}>
              {v.source === 'user' ? (
                <TextInput
                  label={
                    <Group gap={4}>
                      <Text size="xs" fw={500}>
                        {v.label}
                      </Text>
                      <Badge size="xs" color="blue">
                        user
                      </Badge>
                    </Group>
                  }
                  placeholder={`Enter ${v.label}`}
                  value={variables[v.name] || ''}
                  onChange={(e) => handleVarChange(v.name, e.target.value)}
                />
              ) : (
                <Textarea
                  label={
                    <Group gap={4}>
                      <Text size="xs" fw={500}>
                        {v.label}
                      </Text>
                      <Badge size="xs" variant="outline" color="gray">
                        pipeline
                      </Badge>
                    </Group>
                  }
                  placeholder={`Enter test data for ${v.label} (normally auto-populated)`}
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
      </Paper>

      {/* ── Composed Prompt (editable) ────────── */}
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
        <Text size="xs" c="dimmed" mb={8}>
          This is the final prompt that will be sent. You can edit it here before clicking &quot;Run Test&quot;.
        </Text>
        <Textarea
          value={composedPrompt}
          onChange={(e) => setComposedPrompt(e.target.value)}
          autosize
          minRows={8}
          maxRows={30}
          styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
        />
      </Paper>

      {/* ── Results: Raw Response + Formatted Response ── */}
      {result && (
        <Stack gap="md">
          {/* Metadata */}
          <Paper withBorder p="sm">
            <Group gap="lg">
              <Badge color="blue" variant="light">
                Duration: {result.durationMs}ms
              </Badge>
              <Badge color="gray" variant="light">
                Model: {result.model || 'unknown'}
              </Badge>
              {result.usage && (
                <>
                  <Badge color="gray" variant="light">
                    Prompt tokens: {result.usage.prompt_tokens}
                  </Badge>
                  <Badge color="gray" variant="light">
                    Completion tokens: {result.usage.completion_tokens}
                  </Badge>
                </>
              )}
              <Badge color={result.finishReason === 'stop' ? 'green' : 'yellow'} variant="light">
                Finish: {result.finishReason || 'unknown'}
              </Badge>
            </Group>
          </Paper>

          {/* Raw vs Formatted side-by-side */}
          <Grid>
            <Grid.Col span={6}>
              <Paper withBorder p="sm" h="100%">
                <Text fw={600} size="sm" mb={8}>
                  Raw Response
                </Text>
                <ScrollArea h={500}>
                  <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {result.raw || '(empty)'}
                  </Code>
                </ScrollArea>
              </Paper>
            </Grid.Col>
            <Grid.Col span={6}>
              <Paper withBorder p="sm" h="100%">
                <Text fw={600} size="sm" mb={8}>
                  Formatted Response
                </Text>
                <ScrollArea h={500}>
                  <Code block style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {result.formatted || '(empty)'}
                  </Code>
                </ScrollArea>
              </Paper>
            </Grid.Col>
          </Grid>

          {/* Formatting Steps */}
          {(result?.formattingSteps?.length ?? 0) > 0 && (
            <Paper withBorder p="sm">
              <Text fw={600} size="sm" mb={8}>
                Formatting Steps Applied
              </Text>
              <Stack gap={4}>
                {(result.formattingSteps ?? []).map((step: FormattingStepResult, i: number) => (
                  <Group key={i} gap="xs" wrap="wrap">
                    <Badge
                      size="xs"
                      variant="light"
                      color={step.rolledBack ? 'orange' : step.changed ? 'green' : 'gray'}
                    >
                      {i + 1}
                    </Badge>
                    <Text size="xs" fw={500}>
                      {step.label || step.type}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {step.rolledBack
                        ? `Rolled back (${step.before} chars preserved)`
                        : step.changed
                          ? `Changed (${step.before} → ${step.after} chars)`
                          : `No change (${step.before} chars)`}
                    </Text>
                    {step.error && (
                      <Badge size="xs" color="red">
                        {step.error}
                      </Badge>
                    )}
                    {step.warning && (
                      <Text size="xs" c="orange" fw={500}>
                        {step.warning}
                      </Text>
                    )}
                  </Group>
                ))}
              </Stack>
            </Paper>
          )}

          {/* Schema Validation */}
          <SchemaValidationPanel
            formattedText={result.formatted || ''}
            expectedSchema={getJobConfig(selectedJobFull).expectedSchema}
          />
        </Stack>
      )}
    </Stack>
  );
}
