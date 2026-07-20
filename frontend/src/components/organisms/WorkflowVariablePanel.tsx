/**
 * Organism – WorkflowVariablePanel
 * ---------------------------------
 * Pipeline visualization of variables flowing through a workflow.
 * Shows workflow input variables, per-step input/output mappings,
 * and how variables accumulate across the execution.
 */

import { useState, useMemo } from 'react';
import { Stack, Paper, Text, Group, Badge, Loader, Center, Divider, Code } from '@mantine/core';
import { IconVariable } from '@tabler/icons-react';
import { AllVariablesTable } from './workflow-variable-panel/AllVariablesTable';
import { StepPipelineCard } from './workflow-variable-panel/StepPipelineCard';
import { WorkflowInputsBanner } from './workflow-variable-panel/WorkflowInputsBanner';
import { buildVariablePipeline } from './workflow-variable-panel/helpers';
import { useStepJobData } from './workflow-variable-panel/useStepJobData';
import type { WorkflowVariablePanelProps } from './workflow-variable-panel/types';

export default function WorkflowVariablePanel({ steps, inputVariables = [] }: WorkflowVariablePanelProps) {
  const { stepData, loading } = useStepJobData(steps);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const { allVars, stepVarStates } = useMemo(
    () => buildVariablePipeline(stepData, inputVariables),
    [stepData, inputVariables],
  );

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

      <WorkflowInputsBanner inputVariables={inputVariables} />

      {stepData.map((sd, idx) => (
        <StepPipelineCard
          key={sd.stepKey}
          sd={sd}
          stepIndex={idx}
          isExpanded={expandedStep === sd.stepKey}
          stepMappings={stepVarStates.get(sd.stepKey)}
          allVars={allVars}
          onToggle={() => setExpandedStep(expandedStep === sd.stepKey ? null : sd.stepKey)}
        />
      ))}

      <Divider label="All Variables" labelPosition="center" />

      <AllVariablesTable allVars={allVars} />
    </Stack>
  );
}
