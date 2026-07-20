import type { AvailableVariable } from '../../components/molecules/StepVariableMapper';
import type { WorkflowFormData, WorkflowStepFormData } from './types';

export function uid(): string {
  return crypto.randomUUID();
}

export function getAvailableVarsForStep(
  form: WorkflowFormData,
  steps: WorkflowStepFormData[],
  stepIndex: number,
): AvailableVariable[] {
  const vars: AvailableVariable[] = form.inputVariables
    .filter((v) => (v.name ?? '').trim())
    .map((v) => ({ name: v.name, source: 'Application Call' }));

  for (let i = 0; i < stepIndex; i++) {
    const s = steps[i];
    if (!s) continue;
    const outputMappings = s.config?.outputMappings || {};
    for (const workflowVar of Object.values(outputMappings)) {
      if (workflowVar && !vars.some((v) => v.name === workflowVar)) {
        vars.push({ name: workflowVar, source: `Step ${i + 1}: ${s.name || s.step_key}` });
      }
    }
    if (s.step_key) {
      const promptVar = `${s.step_key}.prompt`;
      const responseVar = `${s.step_key}.response`;
      if (!vars.some((v) => v.name === promptVar)) {
        vars.push({ name: promptVar, source: `auto: ${s.name || s.step_key}` });
      }
      if (!vars.some((v) => v.name === responseVar)) {
        vars.push({ name: responseVar, source: `auto: ${s.name || s.step_key}` });
      }
    }
  }
  return vars;
}
