import * as api from '../../../services/api';
import type { ProcessingJob, ProcessingJobConfig, WorkflowInputVariable, WorkflowStepConfig } from '../../../types/api';
import { extractPlaceholders } from '../../../lib/interpolate';
import type { StepJobData, StepVarMappings, VarState, WorkflowStepInfo } from './types';

export async function loadProcessingJobs(steps: WorkflowStepInfo[]): Promise<Map<string, ProcessingJob>> {
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

  return jobMap;
}

export function buildStepJobData(steps: WorkflowStepInfo[], jobMap: Map<string, ProcessingJob>): StepJobData[] {
  const sorted = [...steps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return sorted.map((s) => {
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
}

export function buildVariablePipeline(
  stepData: StepJobData[],
  inputVariables: WorkflowInputVariable[],
): { allVars: VarState[]; stepVarStates: Map<string, StepVarMappings> } {
  const vars: VarState[] = inputVariables
    .filter((v) => (v.name ?? '').trim())
    .map((v) => ({ name: v.name, source: 'workflow input', availableAt: -1 }));

  const perStep = new Map<string, StepVarMappings>();

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
}
