/**
 * Organism – WorkflowVariablePanel
 * ---------------------------------
 * Pipeline visualization of variables flowing through a workflow.
 * Shows workflow input variables, per-step input/output mappings,
 * and how variables accumulate across the execution.
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  Paper,
  Table,
  Badge,
  Text,
  Group,
  Code,
  Collapse,
  UnstyledButton,
  Loader,
  Center,
  Divider,
  ScrollArea,
  ThemeIcon,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconVariable,
  IconArrowRight,
  IconArrowNarrowDown,
} from '@tabler/icons-react';
import * as api from '../../services/api';
import type {
  ProcessingJob,
  ProcessingJobConfig,
  JobVariable,
  WorkflowInputVariable,
  WorkflowStepConfig,
} from '../../types/api';
import { extractPlaceholders } from '../../lib/interpolate';

interface WorkflowStepInfo {
  step_key: string;
  name: string;
  processing_job_id: string;
  sort_order?: number;
  config?: WorkflowStepConfig;
  processing_job?: ProcessingJob | null;
}

interface Props {
  steps: WorkflowStepInfo[];
  inputVariables?: WorkflowInputVariable[];
}

interface StepJobData {
  stepKey: string;
  stepName: string;
  job: ProcessingJob | null;
  config: ProcessingJobConfig;
  stepConfig: WorkflowStepConfig;
  placeholders: string[];
  variables: JobVariable[];
  outputFields: string[];
}

interface VarState {
  name: string;
  source: string;
  availableAt: number;
}

export default function WorkflowVariablePanel({ steps, inputVariables = [] }: Props) {
  const [stepData, setStepData] = useState<StepJobData[]>([]);
  const [loading, setLoading] = useState(steps.length > 0);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadJobs() {
      setLoading(true);
      const jobIds = [...new Set(steps.filter((s) => s.processing_job_id).map((s) => s.processing_job_id))];

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

      if (cancelled) return;

      const sorted = [...steps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const data: StepJobData[] = sorted.map((s) => {
        const job = s.processing_job ?? jobMap.get(s.processing_job_id) ?? null;
        const config = (job?.config ?? {}) as ProcessingJobConfig;
        const stepConfig = (s.config ?? {}) as WorkflowStepConfig;
        const placeholders = extractPlaceholders(config.promptTemplate ?? '');
        const variables = config.variables ?? [];
        const outputFields = Object.keys(config.expectedSchema?.fields ?? {});
        return {
          stepKey: s.step_key,
          stepName: s.name,
          job,
          config,
          stepConfig,
          placeholders,
          variables,
          outputFields,
        };
      });

      setStepData(data);
      setLoading(false);
    }

    if (steps.length === 0) return;
    loadJobs();
    return () => {
      cancelled = true;
    };
  }, [steps]);

  const { allVars, stepVarStates } = useMemo(() => {
    const vars: VarState[] = inputVariables
      .filter((v) => (v.name ?? '').trim())
      .map((v) => ({ name: v.name, source: 'workflow input', availableAt: -1 }));

    const perStep: Map<string, { inputs: Map<string, string>; outputs: Map<string, string> }> = new Map();

    stepData.forEach((sd, idx) => {
      const inputMappings = sd.stepConfig.inputMappings ?? {};
      const outputMappings = sd.stepConfig.outputMappings ?? {};

      const inputs = new Map<string, string>();
      for (const [jobVar, wfVar] of Object.entries(inputMappings)) {
        inputs.set(jobVar, wfVar);
      }

      const outputs = new Map<string, string>();
      for (const [outputField, wfVar] of Object.entries(outputMappings)) {
        outputs.set(outputField, wfVar);
        if (!vars.some((v) => v.name === wfVar)) {
          vars.push({ name: wfVar, source: `step: ${sd.stepName}`, availableAt: idx });
        }
      }

      const promptVar = `${sd.stepKey}.prompt`;
      const responseVar = `${sd.stepKey}.response`;
      if (!vars.some((v) => v.name === promptVar)) {
        vars.push({ name: promptVar, source: `auto: ${sd.stepName}`, availableAt: idx });
      }
      if (!vars.some((v) => v.name === responseVar)) {
        vars.push({ name: responseVar, source: `auto: ${sd.stepName}`, availableAt: idx });
      }

      perStep.set(sd.stepKey, { inputs, outputs });
    });

    return { allVars: vars, stepVarStates: perStep };
  }, [stepData, inputVariables]);

  if (loading) {
    return (
      <Center p="md">
        <Loader size="sm" />
      </Center>
    );
  }

  if (stepData.length === 0) {
    return (
      <Paper p="sm" withBorder>
        <Text size="sm" c="dimmed" ta="center">
          Add steps with processing jobs to see the variable flow.
        </Text>
      </Paper>
    );
  }

  return (
    <Stack gap="sm">
      <Group gap="xs">
        <IconVariable size={16} opacity={0.6} />
        <Text fw={600} size="sm">
          Variable Pipeline
        </Text>
        <Badge size="xs" variant="outline">
          {allVars.length} variable{allVars.length !== 1 ? 's' : ''}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed">
        Variables flow through the workflow as each step completes. Workflow inputs are available from the start. Each
        step can consume variables via input mappings and produce new ones via output mappings. The full prompt and
        response from each step are also automatically captured as{' '}
        <Code style={{ fontSize: 10 }}>{'{{stepKey}}.prompt'}</Code> and{' '}
        <Code style={{ fontSize: 10 }}>{'{{stepKey}}.response'}</Code>.
      </Text>

      {inputVariables.length > 0 && (
        <Paper p="xs" withBorder>
          <Text size="xs" fw={600} mb={4}>
            Workflow Inputs (from calling app)
          </Text>
          <Group gap="xs" wrap="wrap">
            {inputVariables
              .filter((v) => (v.name ?? '').trim())
              .map((v) => (
                <Badge key={v.name} size="sm" variant="light" color="blue" leftSection={<IconArrowRight size={10} />}>
                  {v.name}
                  {v.required ? ' *' : ''}
                </Badge>
              ))}
          </Group>
        </Paper>
      )}

      {stepData.map((sd, idx) => {
        const isExpanded = expandedStep === sd.stepKey;
        const stepMappings = stepVarStates.get(sd.stepKey);
        const inputs = stepMappings?.inputs ?? new Map();
        const outputs = stepMappings?.outputs ?? new Map();

        return (
          <Stack key={sd.stepKey} gap={0}>
            {idx > 0 && (
              <Center>
                <ThemeIcon variant="subtle" size="sm" color="gray">
                  <IconArrowNarrowDown size={16} />
                </ThemeIcon>
              </Center>
            )}
            <Paper p="sm" withBorder>
              <UnstyledButton onClick={() => setExpandedStep(isExpanded ? null : sd.stepKey)} w="100%">
                <Group justify="space-between">
                  <Group gap="xs">
                    {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    <Badge size="xs" color="gray" variant="filled">
                      {idx + 1}
                    </Badge>
                    <Text size="sm" fw={500}>
                      {sd.stepName}
                    </Text>
                    <Code style={{ fontSize: 11 }}>{sd.stepKey}</Code>
                  </Group>
                  <Group gap="xs">
                    {inputs.size > 0 && (
                      <Badge size="xs" variant="light" color="blue">
                        {inputs.size} in
                      </Badge>
                    )}
                    {outputs.size > 0 && (
                      <Badge size="xs" variant="light" color="green">
                        {outputs.size} out
                      </Badge>
                    )}
                    <Badge size="xs" variant="light" color="gray">
                      +2 auto
                    </Badge>
                  </Group>
                </Group>
              </UnstyledButton>

              <Collapse in={isExpanded}>
                <Stack gap="xs" mt="sm">
                  {inputs.size > 0 && (
                    <>
                      <Text size="xs" fw={600}>
                        Inputs (workflow var → job var)
                      </Text>
                      <ScrollArea>
                        <Table withTableBorder style={{ fontSize: 12 }}>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Workflow Variable</Table.Th>
                              <Table.Th>→</Table.Th>
                              <Table.Th>Job Variable</Table.Th>
                              <Table.Th>Available</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {[...inputs.entries()].map(([jobVar, wfVar]) => {
                              const source = allVars.find((v) => v.name === wfVar);
                              const available = source ? source.availableAt < idx : false;
                              return (
                                <Table.Tr key={jobVar}>
                                  <Table.Td>
                                    <Code style={{ fontSize: 11 }}>{wfVar}</Code>
                                  </Table.Td>
                                  <Table.Td>
                                    <IconArrowRight size={12} opacity={0.4} />
                                  </Table.Td>
                                  <Table.Td>
                                    <Code style={{ fontSize: 11 }}>{jobVar}</Code>
                                  </Table.Td>
                                  <Table.Td>
                                    <Badge size="xs" color={available ? 'green' : 'orange'}>
                                      {available ? 'Yes' : 'Not yet'}
                                    </Badge>
                                  </Table.Td>
                                </Table.Tr>
                              );
                            })}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea>
                    </>
                  )}

                  {outputs.size > 0 && (
                    <>
                      <Text size="xs" fw={600}>
                        Outputs (job output → workflow var)
                      </Text>
                      <ScrollArea>
                        <Table withTableBorder style={{ fontSize: 12 }}>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Output Field</Table.Th>
                              <Table.Th>→</Table.Th>
                              <Table.Th>Workflow Variable</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {[...outputs.entries()].map(([field, wfVar]) => (
                              <Table.Tr key={field}>
                                <Table.Td>
                                  <Code style={{ fontSize: 11 }}>{field}</Code>
                                </Table.Td>
                                <Table.Td>
                                  <IconArrowRight size={12} opacity={0.4} />
                                </Table.Td>
                                <Table.Td>
                                  <Badge size="xs" variant="light" color="green">
                                    {wfVar}
                                  </Badge>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea>
                    </>
                  )}

                  <Text size="xs" c="dimmed" fs="italic">
                    Auto-captured: <Code style={{ fontSize: 10 }}>{sd.stepKey}.prompt</Code> and{' '}
                    <Code style={{ fontSize: 10 }}>{sd.stepKey}.response</Code> (the raw LLM input/output for this step)
                  </Text>

                  {inputs.size === 0 && outputs.size === 0 && (
                    <Text size="xs" c="dimmed">
                      No variable mappings configured for this step.
                    </Text>
                  )}
                </Stack>
              </Collapse>
            </Paper>
          </Stack>
        );
      })}

      <Divider label="All Variables" labelPosition="center" />

      <ScrollArea>
        <Table striped withTableBorder style={{ minWidth: 400, fontSize: 12 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Variable</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th>Available From</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {allVars.map((v) => (
              <Table.Tr key={v.name}>
                <Table.Td>
                  <Code style={{ fontSize: 11 }}>{v.name}</Code>
                </Table.Td>
                <Table.Td>
                  <Badge
                    size="xs"
                    variant="light"
                    color={v.availableAt < 0 ? 'blue' : v.source.startsWith('auto:') ? 'teal' : 'green'}
                  >
                    {v.source}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{v.availableAt < 0 ? 'Start' : `After step ${v.availableAt + 1}`}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}
