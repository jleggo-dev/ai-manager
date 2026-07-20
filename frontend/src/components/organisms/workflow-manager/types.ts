import type { Workflow, ProcessingJob, AiProfile } from '../../../types/api';

export interface WorkflowStepDetail {
  id?: string;
  step_key: string;
  name: string;
  processing_job_id: string;
  processing_job?: ProcessingJob | null;
  sort_order?: number;
  is_required?: boolean;
  depends_on?: string[];
  config?: Record<string, unknown>;
}

export interface WorkflowListItem extends Workflow {
  ai_profile?: AiProfile | null;
}

export interface WorkflowDetail extends Omit<Workflow, 'steps'> {
  steps?: WorkflowStepDetail[];
  ai_profile?: AiProfile | null;
}

export type NavigateFn = (key: string, params?: Record<string, unknown>) => void;

export interface WorkflowManagerProps {
  onNavigate?: NavigateFn;
  autoTestWorkflowId?: string;
}

export type ViewMode = 'list' | 'card';
