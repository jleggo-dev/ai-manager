import { request } from './client';
import type { CallingApplication, DiagnosticLog, PaginatedResponse } from '../../types/api';

/* ── Calling Applications API ──────────────────────────────────── */

export function listCallingApplications(params?: {
  cursor?: string;
  limit?: number;
}): Promise<PaginatedResponse<CallingApplication>> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/api/calling-applications${suffix}`);
}

export function createCallingApplication(data: Record<string, unknown>): Promise<CallingApplication> {
  return request('/api/calling-applications', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCallingApplication(id: string, data: Record<string, unknown>): Promise<CallingApplication> {
  return request(`/api/calling-applications/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteCallingApplication(id: string): Promise<void> {
  return request(`/api/calling-applications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* ── Diagnostic Logs API ───────────────────────────────────────── */

interface DiagnosticLogFilters {
  processingJobId?: string;
  chatSessionId?: string;
  callingApplication?: string;
  status?: string;
  limit?: number;
}

export function listDiagnosticLogs(
  filters: DiagnosticLogFilters & { cursor?: string } = {},
): Promise<PaginatedResponse<DiagnosticLog>> {
  const params = new URLSearchParams();
  if (filters.processingJobId) params.set('processingJobId', filters.processingJobId);
  if (filters.chatSessionId) params.set('chatSessionId', filters.chatSessionId);
  if (filters.callingApplication) params.set('callingApplication', filters.callingApplication);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.cursor) params.set('cursor', filters.cursor);
  const qs = params.toString();
  return request(`/api/diagnostic-logs${qs ? `?${qs}` : ''}`);
}

export function getDiagnosticLog(id: string): Promise<DiagnosticLog> {
  return request(`/api/diagnostic-logs/${id}`);
}

export function deleteDiagnosticLog(id: string): Promise<void> {
  return request(`/api/diagnostic-logs/${id}`, { method: 'DELETE' });
}

export function clearDiagnosticLogs(jobId: string): Promise<void> {
  return request(`/api/diagnostic-logs/job/${jobId}`, { method: 'DELETE' });
}
