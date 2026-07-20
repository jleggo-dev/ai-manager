/**
 * Organism – WorkflowTestSimulator
 * ----------------------------------
 * Dry-run and live-run test harness for workflows. Uses each step's
 * processing job testData to preview interpolated prompts (dry run)
 * or execute against the real LLM (live run).
 */

import { Stack, Group, Button, Code, Loader, Center, Alert, Text } from '@mantine/core';
import { IconPlayerPlay, IconAlertTriangle } from '@tabler/icons-react';
import { TestSimulatorHeader } from './workflow-test-simulator/TestSimulatorHeader';
import { TestSimulatorStepCard } from './workflow-test-simulator/TestSimulatorStepCard';
import { useWorkflowTestSimulator } from './workflow-test-simulator/useWorkflowTestSimulator';
import type { WorkflowTestSimulatorProps } from './workflow-test-simulator/types';

export default function WorkflowTestSimulator({ workflow, onClose }: WorkflowTestSimulatorProps) {
  const sim = useWorkflowTestSimulator(workflow);

  if (sim.loading) {
    return (
      <Center p="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <TestSimulatorHeader
        workflowName={workflow.name}
        mode={sim.mode}
        onModeChange={sim.setMode}
        onReset={sim.resetAll}
        onClose={onClose}
      />

      {sim.mode === 'live' && (
        <Alert variant="light" color="blue" icon={<IconAlertTriangle size={16} />}>
          <Text size="xs">
            Live Run calls the real LLM and uses tokens. The test session uses{' '}
            <Code>callingApplication: &quot;ai-admin:workflow-test&quot;</Code>.
          </Text>
        </Alert>
      )}

      {sim.stepStates.map((step, idx) => (
        <TestSimulatorStepCard
          key={step.stepKey}
          step={step}
          stepIndex={idx}
          isExpanded={sim.expandedStep === step.stepKey}
          running={sim.running}
          onToggle={() => sim.setExpandedStep(sim.expandedStep === step.stepKey ? null : step.stepKey)}
          onUpdateVariable={(varName, value) => sim.updateVariable(step.stepKey, varName, value)}
        />
      ))}

      <Group justify="center">
        {sim.mode === 'live' ? (
          <Button
            leftSection={<IconPlayerPlay size={16} />}
            onClick={sim.runLive}
            loading={sim.running}
            disabled={sim.stepStates.length === 0}
          >
            Run All Steps
          </Button>
        ) : (
          <Text size="sm" c="dimmed">
            Dry run — edit variables above to see prompts update in real-time.
            {sim.sessionId && ` (Session: ${sim.sessionId.slice(0, 8)}…)`}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
