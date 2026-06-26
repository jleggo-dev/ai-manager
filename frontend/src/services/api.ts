import { getAccessToken, getWorkspaceId, getSessionUser } from '../lib/auth-session';
import { resolveApiUrl } from '../lib/api-url';
import type {
  Provider,
  AiProfile,
  ProcessingJob,
  ChatSession,
  ChatMessage,
  AppSetting,
  CallingApplication,
  Workflow,
  WorkflowStep,
  DiagnosticLog,
  ProcessingJobGroup,
  LlmModel,
  SyncModelsResult,
  HealthCheckResult,
  WorkspaceMembership,
  ApiKey,
  CreateApiKeyResponse,
  WorkspaceMember,
  UserCredential,
  PaginatedResponse,
  AiMatcherSlotResult,
  HcProviderKey,
  HcProfile,
  HcCheck,
  HcRun,
  HcIncident,
  HcDashboardItem,
  WidgetHcCheck,
  WidgetHcRun,
  WidgetHcIncident,
  WidgetHcDashboardItem,
  WidgetHcTimeouts,
  CheckUptimeHistory,
  RunListResponse,
  FailurePatterns,
} from '../types/api';

export type {
  Provider,
  AiProfile,
  ProcessingJob,
  ChatSession,
  ChatMessage,
  AppSetting,
  CallingApplication,
  Workflow,
  WorkflowStep,
  DiagnosticLog,
  ProcessingJobGroup,
  LlmModel,
  SyncModelsResult,
  HealthCheckResult,
  WorkspaceMembership,
  ApiKey,
  CreateApiKeyResponse,
  WorkspaceMember,
  UserCredential,
  PaginatedResponse,
  AiMatcherSlotResult,
  HcProviderKey,
  HcProfile,
  HcCheck,
  HcRun,
  HcIncident,
  HcDashboardItem,
  WidgetHcCheck,
  WidgetHcRun,
  WidgetHcIncident,
  WidgetHcDashboardItem,
  WidgetHcTimeouts,
  CheckUptimeHistory,
} from '../types/api';

const IS_DEV_AUTH = Boolean(import.meta.env.VITE_DEV_API_KEY);

function devUserHeader(headers: Record<string, string>): void {
  if (IS_DEV_AUTH) {
    const user = getSessionUser();
    if (user?.id) headers['X-Forwarded-User-Id'] = user.id;
  }
}

export function getApiAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const ws = getWorkspaceId();
  if (ws) headers['X-Workspace-Id'] = ws;
  devUserHeader(headers);
  return headers;
}

interface RequestOptions extends Omit<RequestInit, 'headers'> {
  skipWorkspaceHeader?: boolean;
  headers?: Record<string, string>;
}

async function request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const { skipWorkspaceHeader, ...fetchOpts } = options;
  const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json', ...fetchOpts.headers };
  const token = getAccessToken();
  if (token) baseHeaders.Authorization = `Bearer ${token}`;
  const ws = getWorkspaceId();
  if (ws && !skipWorkspaceHeader) baseHeaders['X-Workspace-Id'] = ws;
  devUserHeader(baseHeaders);

  const res = await fetch(resolveApiUrl(url), {
    ...fetchOpts,
    headers: baseHeaders,
  });

  if (res.status === 204) return null as unknown as T;

  if (!res.ok) {
    let data: { error?: string; details?: { path: string; message: string }[] };
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    const message = data.details?.length
      ? `${data.error || 'Validation failed'}: ${data.details.map((d) => d.message).join('; ')}`
      : data.error || `Request failed (${res.status})`;
    throw Object.assign(new Error(message), {
      status: res.status,
      data,
      details: data.details,
    });
  }
  return res.json();
}

/**
 * Extract field-level validation details from an API error, if present.
 */
export function getValidationDetails(err: unknown): { path: string; message: string }[] | undefined {
  return (err as { details?: { path: string; message: string }[] })?.details;
}

/* ── Providers API ─────────────────────────────────────────────── */

export function listProviders(params?: { cursor?: string; limit?: number }): Promise<PaginatedResponse<Provider>> {
  const qs = new URLSearchParams();
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/api/providers${suffix}`);
}

export function createProvider(data: Record<string, unknown>): Promise<Provider> {
  return request('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateProvider(id: string, data: Record<string, unknown>): Promise<Provider> {
  return request(`/api/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteProvider(id: string): Promise<void> {
  return request(`/api/providers/${id}`, { method: 'DELETE' });
}

export function testProvider(id: string): Promise<Record<string, unknown>> {
  return request(`/api/providers/${id}/test`, { method: 'POST' });
}

export function listProviderAis(id: string, scope?: string): Promise<AiProfile[]> {
  const qs = scope ? `?scope=${scope}` : '';
  return request(`/api/providers/${id}/ais${qs}`);
}

/* ── LLM Models (per-provider model registry) ──────────────────── */

export function listProviderModels(providerId: string): Promise<LlmModel[]> {
  return request(`/api/providers/${providerId}/models`);
}

export function syncProviderModels(providerId: string): Promise<SyncModelsResult> {
  return request(`/api/providers/${providerId}/models/sync`, {
    method: 'POST',
  });
}

export function addProviderModel(providerId: string, data: Record<string, unknown>): Promise<LlmModel> {
  return request(`/api/providers/${providerId}/models`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function bulkAddProviderModels(providerId: string, models: Record<string, unknown>[]): Promise<LlmModel[]> {
  return request(`/api/providers/${providerId}/models`, {
    method: 'POST',
    body: JSON.stringify({ models }),
  });
}

export function updateProviderModel(
  providerId: string,
  modelId: string,
  data: Record<string, unknown>,
): Promise<LlmModel> {
  return request(`/api/providers/${providerId}/models/${modelId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteProviderModel(providerId: string, modelId: string): Promise<void> {
  return request(`/api/providers/${providerId}/models/${modelId}`, { method: 'DELETE' });
}

/* ── AI Profiles API ───────────────────────────────────────────── */

export function listAiProfiles(
  providerId?: string,
  params?: { cursor?: string; limit?: number },
): Promise<PaginatedResponse<AiProfile>> {
  const qs = new URLSearchParams();
  if (providerId) qs.set('provider_id', providerId);
  if (params?.cursor) qs.set('cursor', params.cursor);
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/api/ai-profiles${suffix}`);
}

export function createAiProfile(data: Record<string, unknown>): Promise<AiProfile> {
  return request('/api/ai-profiles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateAiProfile(id: string, data: Record<string, unknown>): Promise<AiProfile> {
  return request(`/api/ai-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteAiProfile(id: string): Promise<void> {
  return request(`/api/ai-profiles/${id}`, { method: 'DELETE' });
}

export function getDefaultAiProfile(): Promise<AiProfile> {
  return request('/api/ai-profiles/default');
}

export function setAiProfileDefault(id: string): Promise<AiProfile> {
  return request(`/api/ai-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ is_default: true }),
  });
}

export function clearAiProfileDefault(id: string): Promise<AiProfile> {
  return request(`/api/ai-profiles/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ is_default: false }),
  });
}

export function testAiProfileChat(
  id: string,
  message: string,
  systemPrompt?: string,
): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${id}/test-chat`, {
    method: 'POST',
    body: JSON.stringify({ message, systemPrompt: systemPrompt || undefined }),
  });
}

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

export function listFormattingRules(): Promise<Record<string, unknown>> {
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

/* ── App Settings ──────────────────────────────────────────────── */

export function listSettings(): Promise<AppSetting[]> {
  return request('/api/settings');
}

export function getSettingByKey(key: string): Promise<AppSetting> {
  return request(`/api/settings/${encodeURIComponent(key)}`);
}

export function upsertSetting(key: string, value: unknown, description?: string): Promise<AppSetting> {
  return request(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value, description }),
  });
}

export function deleteSettingByKey(key: string): Promise<void> {
  return request(`/api/settings/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

/* ── Chat Sessions ─────────────────────────────────────────────── */

interface CreateChatSessionParams {
  aiProfileId?: string;
  jobSlug?: string;
  jobId?: string;
  userId: string;
  callingApplication?: string;
  systemPrompt?: string;
}

export async function createChatSession({
  aiProfileId,
  jobSlug,
  jobId,
  userId,
  callingApplication,
  systemPrompt,
}: CreateChatSessionParams): Promise<ChatSession> {
  return request('/api/chat-sessions', {
    method: 'POST',
    body: JSON.stringify({
      aiProfileId: aiProfileId || undefined,
      jobSlug: jobSlug || undefined,
      jobId: jobId || undefined,
      userId,
      callingApplication: callingApplication || 'ai-admin',
      systemPrompt: systemPrompt || undefined,
    }),
  });
}

export function sendChatMessageStream(sessionId: string, message: string): Promise<Response> {
  return fetch(resolveApiUrl(`/api/chat-sessions/${sessionId}/messages`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() },
    body: JSON.stringify({ message }),
  });
}

interface ChatSessionFilters {
  userId?: string;
  aiProfileId?: string;
  workflowId?: string;
  status?: string;
}

export async function listChatSessions(
  filters: ChatSessionFilters & { cursor?: string; limit?: number } = {},
): Promise<PaginatedResponse<ChatSession>> {
  const params = new URLSearchParams();
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.aiProfileId) params.set('aiProfileId', filters.aiProfileId);
  if (filters.workflowId) params.set('workflowId', filters.workflowId);
  if (filters.status) params.set('status', filters.status);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return request(`/api/chat-sessions${qs ? `?${qs}` : ''}`);
}

export async function getChatSession(sessionId: string): Promise<ChatSession> {
  return request(`/api/chat-sessions/${sessionId}`);
}

export async function getChatMessages(
  sessionId: string,
  { fromProvider }: { fromProvider?: boolean } = {},
): Promise<ChatMessage[]> {
  const qs = fromProvider ? '?fromProvider=true' : '';
  return request(`/api/chat-sessions/${sessionId}/messages${qs}`);
}

export async function resetChatSession(sessionId: string): Promise<ChatSession> {
  return request(`/api/chat-sessions/${sessionId}/reset`, { method: 'PUT' });
}

export async function closeChatSession(sessionId: string): Promise<ChatSession> {
  return request(`/api/chat-sessions/${sessionId}/close`, { method: 'PUT' });
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  return request(`/api/chat-sessions/${sessionId}`, { method: 'DELETE' });
}

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

/* ── Health Check ──────────────────────────────────────────────── */

export function healthCheck(): Promise<HealthCheckResult> {
  return request('/api/health');
}

export function listWorkspaces(): Promise<{ workspaces: WorkspaceMembership[] }> {
  return request('/api/workspaces', { skipWorkspaceHeader: true });
}

export function listApiKeys(): Promise<{ apiKeys: ApiKey[] }> {
  return request('/api/api-keys');
}

export function createApiKey(name: string): Promise<CreateApiKeyResponse> {
  return request('/api/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function deleteApiKey(id: string): Promise<void> {
  return request(`/api/api-keys/${id}`, { method: 'DELETE' });
}

export function listWorkspaceMembers(workspaceId: string): Promise<{ members: WorkspaceMember[] }> {
  return request(`/api/workspaces/${workspaceId}/members`);
}

export function updateWorkspaceMemberRole(
  workspaceId: string,
  memberUserId: string,
  role: string,
): Promise<WorkspaceMember> {
  return request(`/api/workspaces/${workspaceId}/members/${memberUserId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

/* ── User Provider Credentials ─────────────────────────────────── */

export function listUserCredentials(): Promise<UserCredential[]> {
  return request('/api/user-credentials');
}

export function upsertUserCredential(providerId: string, apiKey: string, label?: string): Promise<UserCredential> {
  return request('/api/user-credentials', {
    method: 'POST',
    body: JSON.stringify({ providerId, apiKey, label: label || undefined }),
  });
}

export function deleteUserCredential(id: string): Promise<void> {
  return request(`/api/user-credentials/${id}`, { method: 'DELETE' });
}

/* ── User Data Deletion (GDPR / CCPA compliance) ──────────────── */

export type UserDataScope = 'all' | 'sessions' | 'diagnostic-logs' | 'credentials';

export interface UserDataDeletionResult {
  deleted: {
    sessions?: number;
    diagnosticLogs?: number;
    credentials?: number;
  };
}

export function deleteUserData(userId: string, scope: UserDataScope): Promise<UserDataDeletionResult> {
  const path = scope === 'all' ? `/api/user-data/${userId}` : `/api/user-data/${userId}/${scope}`;
  return request(path, {
    method: 'DELETE',
    body: JSON.stringify({ confirm: 'DELETE_USER_DATA' }),
  });
}

/* ── AI Profile Tools & MCP ────────────────────────────────────── */

export function listProfileTools(profileId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools`);
}

export function listProfileMcpTools(profileId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools/mcp`);
}

export function listProfileToolAuthStatus(profileId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools/auth-status`);
}

export function getToolOAuthStatus(profileId: string, toolId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools/${toolId}/oauth-status`);
}

export function initiateToolOAuth(profileId: string, toolId: string): Promise<Record<string, unknown>> {
  return request(`/api/ai-profiles/${profileId}/tools/${toolId}/oauth-initiate`, {
    method: 'POST',
  });
}

export function deleteToolOAuthToken(profileId: string, toolId: string): Promise<void> {
  return request(`/api/ai-profiles/${profileId}/tools/${toolId}/oauth-token`, {
    method: 'DELETE',
  });
}

export function submitChatToolOutputs(
  sessionId: string,
  systemMessageId: string,
  outputs: Record<string, unknown>[],
): Promise<Response> {
  return fetch(resolveApiUrl(`/api/chat-sessions/${sessionId}/tool-outputs`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() },
    body: JSON.stringify({ systemMessageId, outputs }),
  });
}

/* ── Health Checker API ─────────────────────────────────────────── */

export function listHcProviderKeys(): Promise<{ data: HcProviderKey[] }> {
  return request('/api/health-checks/provider-keys');
}

export function createHcProviderKey(data: Record<string, unknown>): Promise<HcProviderKey> {
  return request('/api/health-checks/provider-keys', { method: 'POST', body: JSON.stringify(data) });
}

export function updateHcProviderKey(id: string, data: Record<string, unknown>): Promise<HcProviderKey> {
  return request(`/api/health-checks/provider-keys/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteHcProviderKey(id: string): Promise<void> {
  return request(`/api/health-checks/provider-keys/${id}`, { method: 'DELETE' });
}

export function listHcProfiles(): Promise<{ data: HcProfile[] }> {
  return request('/api/health-checks/profiles');
}

export function createHcProfile(data: Record<string, unknown>): Promise<HcProfile> {
  return request('/api/health-checks/profiles', { method: 'POST', body: JSON.stringify(data) });
}

export function updateHcProfile(id: string, data: Record<string, unknown>): Promise<HcProfile> {
  return request(`/api/health-checks/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteHcProfile(id: string): Promise<void> {
  return request(`/api/health-checks/profiles/${id}`, { method: 'DELETE' });
}

export function listHcChecks(): Promise<{ data: HcCheck[] }> {
  return request('/api/health-checks');
}

export function createHcCheck(data: Record<string, unknown>): Promise<HcCheck> {
  return request('/api/health-checks', { method: 'POST', body: JSON.stringify(data) });
}

export function backfillHcChecks(): Promise<{ success: boolean; created: number; total_profiles: number }> {
  return request('/api/health-checks/profiles/backfill-checks', { method: 'POST' });
}

export function updateHcCheck(id: string, data: Record<string, unknown>): Promise<HcCheck> {
  return request(`/api/health-checks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteHcCheck(id: string, deleteProfile = false): Promise<void> {
  const qs = deleteProfile ? '?deleteProfile=true' : '';
  return request(`/api/health-checks/${id}${qs}`, { method: 'DELETE' });
}

export function runHcCheck(id: string): Promise<HcRun> {
  return request(`/api/health-checks/${id}/run`, { method: 'POST' });
}

export function listHcRuns(id: string, limit = 50): Promise<{ data: HcRun[] }> {
  return request(`/api/health-checks/${id}/runs?limit=${limit}`);
}

export function listHcIncidents(id: string, limit = 20): Promise<{ data: HcIncident[] }> {
  return request(`/api/health-checks/${id}/incidents?limit=${limit}`);
}

export function getHcDashboard(): Promise<{ data: HcDashboardItem[] }> {
  return request('/api/health-checks/dashboard');
}

/* ── Widget Health Checks ────────────────────────────────── */

export function listWidgetHcChecks(): Promise<{ data: WidgetHcCheck[] }> {
  return request('/api/widget-health-checks');
}

export function createWidgetHcCheck(data: Partial<WidgetHcCheck>): Promise<WidgetHcCheck> {
  return request('/api/widget-health-checks', { method: 'POST', body: JSON.stringify(data) });
}

export function updateWidgetHcCheck(id: string, data: Partial<WidgetHcCheck>): Promise<WidgetHcCheck> {
  return request(`/api/widget-health-checks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export function deleteWidgetHcCheck(id: string): Promise<void> {
  return request(`/api/widget-health-checks/${id}`, { method: 'DELETE' });
}

export function runWidgetHcCheck(id: string): Promise<WidgetHcRun> {
  return request(`/api/widget-health-checks/${id}/run`, { method: 'POST' });
}

export function listWidgetHcRuns(id: string): Promise<{ data: WidgetHcRun[] }> {
  return request(`/api/widget-health-checks/${id}/runs`);
}

export function getWidgetRunScreenshot(runId: string): Promise<{ url: string }> {
  return request(`/api/widget-health-checks/runs/${runId}/screenshot`);
}

export function listWidgetHcIncidents(id: string): Promise<{ data: WidgetHcIncident[] }> {
  return request(`/api/widget-health-checks/${id}/incidents`);
}

export function getWidgetHcDashboard(): Promise<{ data: WidgetHcDashboardItem[] }> {
  return request('/api/widget-health-checks/dashboard');
}

export async function getWidgetHcGlobalTimeouts(): Promise<WidgetHcTimeouts> {
  try {
    const setting = await getSettingByKey('widget_hc_timeouts');
    return setting.value as unknown as WidgetHcTimeouts;
  } catch {
    return {
      page_load_timeout_ms: 60000,
      widget_load_timeout_ms: 30000,
      response_timeout_ms: 60000,
      slow_page_load_ms: 15000,
      slow_widget_load_ms: 10000,
      slow_response_ms: 30000,
    };
  }
}

export function saveWidgetHcGlobalTimeouts(timeouts: WidgetHcTimeouts): Promise<AppSetting> {
  return upsertSetting(
    'widget_hc_timeouts',
    timeouts,
    'Global timeout defaults for widget health checks (overridable per-check)',
  );
}

/* ── Uptime History ──────────────────────────────────────── */

export function getHcUptimeHistory(days = 365): Promise<{ data: CheckUptimeHistory[] }> {
  return request(`/api/health-checks/uptime-history?days=${days}`);
}

export function getWidgetHcUptimeHistory(days = 365): Promise<{ data: CheckUptimeHistory[] }> {
  return request(`/api/widget-health-checks/uptime-history?days=${days}`);
}

/* ── Filtered Run Listing ────────────────────────────────── */

export interface RunFilterParams {
  status?: string;
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
}

function buildRunQuery(checkId: string, base: string, params: RunFilterParams = {}): string {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.offset) qs.set('offset', String(params.offset));
  if (params.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return `${base}/${checkId}/runs${query ? `?${query}` : ''}`;
}

export function listHcRunsFiltered(checkId: string, params?: RunFilterParams): Promise<RunListResponse<HcRun>> {
  return request(buildRunQuery(checkId, '/api/health-checks', params));
}

export function listWidgetHcRunsFiltered(
  checkId: string,
  params?: RunFilterParams,
): Promise<RunListResponse<WidgetHcRun>> {
  return request(buildRunQuery(checkId, '/api/widget-health-checks', params));
}

/* ── Failure Patterns ────────────────────────────────────── */

export function getHcFailurePatterns(checkId: string, from?: string, to?: string): Promise<FailurePatterns> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const query = qs.toString();
  return request(`/api/health-checks/${checkId}/failure-patterns${query ? `?${query}` : ''}`);
}

export function getWidgetHcFailurePatterns(checkId: string, from?: string, to?: string): Promise<FailurePatterns> {
  const qs = new URLSearchParams();
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const query = qs.toString();
  return request(`/api/widget-health-checks/${checkId}/failure-patterns${query ? `?${query}` : ''}`);
}
