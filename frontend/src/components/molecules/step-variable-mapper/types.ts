import type { ProcessingJob, WorkflowStepConfig } from '../../../types/api';

export interface AvailableVariable {
  name: string;
  source: string;
}

export interface StepFormData {
  _uid: string;
  step_key: string;
  name: string;
  processing_job_id: string | null;
  is_required?: boolean;
  depends_on: string[];
  config: WorkflowStepConfig;
}

export interface StepVariableMapperProps {
  step: StepFormData;
  stepIndex: number;
  jobs: ProcessingJob[];
  allStepKeys: string[];
  availableVars: AvailableVariable[];
  onUpdate: (updates: Partial<StepFormData>) => void;
}
