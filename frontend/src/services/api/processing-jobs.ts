import { request } from './client';
import type {
  ProcessingJob,
  ProcessingJobGroup,
  PaginatedResponse,
  AiMatcherSlotResult,
  AvailableFormattingRule,
} from '../../types/api';

/* ── Processing Jobs API ───────────────────────────────────────── */

export function listProcessingJobs(params?: {
  cursor?: string;
  limit?: number;
}): Promise<PaginatedResponse<ProcessingJob>> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/api/processing-jobs${suffix}`);
}

export function createProcessingJob(data: Record<string, unknown>): Promise<ProcessingJob> {
  return request('/api/processing-jobs', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProcessingJob(id: string, data: Record<string, unknown>): Promise<ProcessingJob> {
  return request(`/api/processing-jobs/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteProcessingJob(id: string): Promise<void> {
  return request(`/api/processing-jobs/${id}`, { method: 'DELETE' });
}

export function batchUpdateProcessingJobs(updates: Record<string, unknown>[]): Promise<ProcessingJob[]> {
  return request('/api/processing-jobs/batch', {
    method: 'PATCH',
    body: JSON.stringify({ updates }),
  });
}

export function getProcessingJob(id: string): Promise<ProcessingJob> {
  return request(`/api/processing-jobs/${id}`);
}

export function testProcessingJob(
  id: string,
  variables: Record<string, unknown>,
  promptOverride?: string,
): Promise<Record<string, unknown>> {
  return request(`/api/processing-jobs/${id}/test`, {
    method: 'POST',
    body: JSON.stringify({
      variables,
      promptOverride: promptOverride || undefined,
    }),
  });
}

export function runAiMatcherSlot(payload: Record<string, unknown>): Promise<AiMatcherSlotResult> {
  return request('/api/ai-matcher/run-slot', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listFormattingRules(): Promise<AvailableFormattingRule[]> {
  return request('/api/processing-jobs/formatting-rules');
}

export function applyFormattingRules(text: string, rules: unknown[]): Promise<Record<string, unknown>> {
  return request('/api/processing-jobs/apply-formatting', {
    method: 'POST',
    body: JSON.stringify({ text, rules }),
  });
}

/* ── Processing Job Groups ─────────────────────────────────────── */

export function listProcessingJobGroups(appId?: string): Promise<ProcessingJobGroup[]> {
  const qs = appId ? `?appId=${encodeURIComponent(appId)}` : '';
  return request(`/api/processing-job-groups${qs}`);
}

export function createProcessingJobGroup(data: Record<string, unknown>): Promise<ProcessingJobGroup> {
  return request('/api/processing-job-groups', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProcessingJobGroup(id: string, data: Record<string, unknown>): Promise<ProcessingJobGroup> {
  return request(`/api/processing-job-groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteProcessingJobGroup(id: string): Promise<void> {
  return request(`/api/processing-job-groups/${id}`, {
    method: 'DELETE',
  });
}
