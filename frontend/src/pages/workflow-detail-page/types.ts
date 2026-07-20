import type { AiProfile, ChatSession, ProcessingJob, WorkflowInputVariable, WorkflowStep } from '../../types/api';

export type NavigateFn = (key: string, params?: Record<string, unknown>) => void;

export interface WorkflowDetailPageProps {
  onNavigate: NavigateFn;
  pageParams: Record<string, unknown>;
}

export interface WorkflowDetail {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  is_active?: boolean;
  ai_profile_id?: string | null;
  ai_profile?: AiProfile | null;
  config?: Record<string, unknown>;
  steps?: (WorkflowStep & { processing_job?: ProcessingJob | null })[];
}

export type SessionSortField = 'id' | 'status' | 'message_count' | 'created_at';
export type SessionSortDir = 'asc' | 'desc';

export interface SessionFilterState {
  sortField: SessionSortField;
  sortDir: SessionSortDir;
  statusFilter: string | null;
  searchQuery: string;
}

export function filterAndSortSessions(
  execSessions: ChatSession[],
  { sortField, sortDir, statusFilter, searchQuery }: SessionFilterState,
): ChatSession[] {
  let result = [...execSessions];

  if (statusFilter) result = result.filter((s) => s.status === statusFilter);
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    result = result.filter(
      (s) => s.id.toLowerCase().includes(q) || (s.calling_application || '').toLowerCase().includes(q),
    );
  }

  result.sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'id':
        cmp = a.id.localeCompare(b.id);
        break;
      case 'status':
        cmp = (a.status || '').localeCompare(b.status || '');
        break;
      case 'message_count':
        cmp = (a.message_count ?? 0) - (b.message_count ?? 0);
        break;
      case 'created_at':
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return result;
}

export function getInputVariables(config?: Record<string, unknown>): WorkflowInputVariable[] | undefined {
  return config?.inputVariables as WorkflowInputVariable[] | undefined;
}
