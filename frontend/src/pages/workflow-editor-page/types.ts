import type { WorkflowStepConfig } from '../../types/api';
import type { InputVariableFormItem } from '../../components/molecules/WorkflowInputEditor';

export type NavigateFn = (key: string, params?: Record<string, unknown>) => void;

export interface WorkflowEditorPageProps {
  onNavigate: NavigateFn;
  pageParams: Record<string, unknown>;
}

export interface WorkflowFormData {
  name: string;
  slug: string;
  description: string;
  ai_profile_id: string | null;
  is_active: boolean;
  inputVariables: InputVariableFormItem[];
}

export interface WorkflowStepFormData {
  _uid: string;
  id?: string;
  step_key: string;
  name: string;
  processing_job_id: string | null;
  sort_order?: number;
  is_required?: boolean;
  depends_on: string[];
  config: WorkflowStepConfig;
}
