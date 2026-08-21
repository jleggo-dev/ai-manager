import type { AiProfileRow, ProcessingJobRow } from './providers-and-profiles.ts';

export interface WorkflowInputVariable {
  name: string;
  label?: string;
  description?: string;
  required?: boolean;
}

export interface WorkflowConfig {
  inputVariables?: WorkflowInputVariable[];
  systemPrompt?: string;
  [key: string]: unknown;
}

export interface WorkflowStepConfig {
  inputMappings?: Record<string, string>;
  outputMappings?: Record<string, string>;
  /** input steps only — the workflow variable the user's answer is stored under. */
  collects?: string;
  /** input steps only — what to show the person. The app's own voice, not a prompt template. */
  prompt?: string;
  [key: string]: unknown;
}

export interface WorkflowRow {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  ai_profile_id?: string | null;
  ai_profile?: AiProfileRow | null;
  config?: WorkflowConfig;
  is_active: boolean;
  steps?: WorkflowStepRow[];
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

/**
 * `job` sends the step's processing job to the LLM — the original behaviour, and the default, so
 * every step written before 2026-08-21 keeps working untouched. `input` pauses for the user: their
 * answer lands in `workflow_variables` under `config.collects` and the step completes with no model
 * call at all.
 */
export type WorkflowStepType = 'job' | 'input';

export interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  step_type: WorkflowStepType;
  /** null ONLY when step_type is 'input' — enforced by a check constraint, not by convention. */
  processing_job_id: string | null;
  processing_job?: ProcessingJobRow | null;
  step_key: string;
  name: string;
  sort_order?: number;
  is_required?: boolean;
  depends_on?: string[];
  config?: WorkflowStepConfig;
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

export interface TriggerRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description?: string | null;
  trigger_type: 'external_clock' | 'session.message.created' | 'workflow.step.completed';
  target_type: 'job' | 'workflow';
  target_slug: string;
  config?: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}
