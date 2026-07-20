/**
 * Organism – WorkflowExecutionLog
 * --------------------------------
 * Per-step execution timeline for a workflow session. Shows the prompt,
 * response, variable diff, and full diagnostic log for each step.
 */

import { useState, useEffect, useMemo } from 'react';
import { Stack, Text, Group, Badge, Loader, Center, Alert } from '@mantine/core';
import { IconActivity } from '@tabler/icons-react';
import * as api from '../../services/api';
import type { ChatMessage, DiagnosticLog, WorkflowStep } from '../../types/api';
import { buildStepExecutions } from './workflow-execution-log/buildStepExecutions';
import { StepExecutionCard } from './workflow-execution-log/StepExecutionCard';

interface Props {
  sessionId: string;
  steps: WorkflowStep[];
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

  const stepExecutions = useMemo(
    () => buildStepExecutions(steps, messages, diagnostics),
    [steps, messages, diagnostics],
  );

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

      {stepExecutions.map((exec, idx) => (
        <StepExecutionCard
          key={exec.stepKey}
          exec={exec}
          index={idx}
          isExpanded={expandedStep === exec.stepKey}
          onToggle={() => setExpandedStep(expandedStep === exec.stepKey ? null : exec.stepKey)}
        />
      ))}
    </Stack>
  );
}
