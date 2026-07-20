import type { ChatMessage, DiagnosticLog, WorkflowStep } from '../../../types/api';
import type { StepExecution } from './types';

/** Correlate chat messages + diagnostics into a per-step execution timeline. */
export function buildStepExecutions(
  steps: WorkflowStep[],
  messages: ChatMessage[],
  diagnostics: DiagnosticLog[],
): StepExecution[] {
  const sortedSteps = [...steps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const stepIdToKey = new Map<string, { key: string; name: string; order: number }>();
  sortedSteps.forEach((s, i) => {
    if (s.id) stepIdToKey.set(s.id, { key: s.step_key, name: s.name, order: s.sort_order ?? i });
  });

  const userMsgsByStep = new Map<string, ChatMessage>();
  const assistantMsgsByStep = new Map<string, ChatMessage>();
  const sortedMsgs = [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
}
