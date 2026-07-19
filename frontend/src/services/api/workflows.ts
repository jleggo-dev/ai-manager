import { request } from './client';
import type { Workflow, WorkflowStep, PaginatedResponse } from '../../types/api';

/* ── Workflows ─────────────────────────────────────────────────── */

export function listWorkflows(params?: { cursor?: string; limit?: number }): Promise<PaginatedResponse<Workflow>> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/api/workflows${suffix}`);
}

export function getWorkflow(id: string): Promise<Workflow> {
  return request(`/api/workflows/${id}`);
}

export function createWorkflow(data: Record<string, unknown>): Promise<Workflow> {
  return request('/api/workflows', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateWorkflow(id: string, data: Record<string, unknown>): Promise<Workflow> {
  return request(`/api/workflows/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteWorkflow(id: string): Promise<void> {
  return request(`/api/workflows/${id}`, { method: 'DELETE' });
}

export function listWorkflowSteps(workflowId: string): Promise<WorkflowStep[]> {
  return request(`/api/workflows/${workflowId}/steps`);
}

export function createWorkflowStep(workflowId: string, data: Record<string, unknown>): Promise<WorkflowStep> {
  return request(`/api/workflows/${workflowId}/steps`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateWorkflowStep(
  workflowId: string,
  stepId: string,
  data: Record<string, unknown>,
): Promise<WorkflowStep> {
  return request(`/api/workflows/${workflowId}/steps/${stepId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteWorkflowStep(workflowId: string, stepId: string): Promise<void> {
  return request(`/api/workflows/${workflowId}/steps/${stepId}`, { method: 'DELETE' });
}
