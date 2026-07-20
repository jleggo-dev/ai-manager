import { useState, useEffect, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../../../services/api';
import { resolveApiUrl } from '../../../lib/api-url';
import type { ProcessingJob } from '../../../types/api';
import { interpolateTemplate } from '../../../lib/interpolate';
import { buildStepStates, getAuthHeaders, readStreamResponse } from './helpers';
import type { StepState, TestMode, WorkflowTestSimulatorProps } from './types';

export function useWorkflowTestSimulator(workflow: WorkflowTestSimulatorProps['workflow']) {
  const [mode, setMode] = useState<TestMode>('dry');
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

    const states = buildStepStates(sorted, jobMap);
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

          const fullText = await readStreamResponse(res);
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

  return {
    mode,
    setMode,
    stepStates,
    loading,
    expandedStep,
    setExpandedStep,
    running,
    sessionId,
    updateVariable,
    resetAll,
    runLive,
  };
}
