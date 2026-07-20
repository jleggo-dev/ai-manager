import type { ProcessingJob, Workflow, WorkflowStepConfig } from '../../../types/api';

export interface WorkflowStepInfo {
  id?: string;
  step_key: string;
  name: string;
  processing_job_id: string;
  sort_order?: number;
  depends_on?: string[];
  config?: WorkflowStepConfig;
  processing_job?: ProcessingJob | null;
}

export interface WorkflowTestSimulatorProps {
  workflow: Workflow & { steps?: WorkflowStepInfo[] };
  onClose?: () => void;
}

export interface StepState {
  stepKey: string;
  stepName: string;
  jobName: string;
  template: string;
  variables: Record<string, string>;
  placeholders: string[];
  interpolated: string;
  missingKeys: string[];
  inputMappings: Record<string, string>;
  outputMappings: Record<string, string>;
  accumulatedAfter: Record<string, string>;
  status: 'pending' | 'ready' | 'running' | 'done' | 'error';
  response?: string;
  error?: string;
  durationMs?: number;
  tokenUsage?: { prompt?: number; completion?: number };
}

export type TestMode = 'dry' | 'live';
