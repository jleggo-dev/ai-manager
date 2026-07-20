import type {
  ProcessingJob,
  ProcessingJobConfig,
  JobVariable,
  WorkflowInputVariable,
  WorkflowStepConfig,
} from '../../../types/api';

export interface WorkflowStepInfo {
  step_key: string;
  name: string;
  processing_job_id: string;
  sort_order?: number;
  config?: WorkflowStepConfig;
  processing_job?: ProcessingJob | null;
}

export interface WorkflowVariablePanelProps {
  steps: WorkflowStepInfo[];
  inputVariables?: WorkflowInputVariable[];
}

export interface StepJobData {
  stepKey: string;
  stepName: string;
  job: ProcessingJob | null;
  config: ProcessingJobConfig;
  stepConfig: WorkflowStepConfig;
  placeholders: string[];
  variables: JobVariable[];
  outputFields: string[];
}

export interface VarState {
  name: string;
  source: string;
  availableAt: number;
}

export interface StepVarMappings {
  inputs: Map<string, string>;
  outputs: Map<string, string>;
}
