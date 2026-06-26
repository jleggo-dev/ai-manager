import type { SupabaseClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';

/* ── Auth ──────────────────────────────────────────────────── */

export type AuthMode = 'jwt' | 'api_key';

interface JwtAuthContext {
  mode: 'jwt';
  workspaceId: string | null;
  userId: string;
  userClient: SupabaseClient;
}

interface ApiKeyAuthContext {
  mode: 'api_key';
  workspaceId: string;
  apiKeyId: string;
  userId?: string;
  forwardedUserId?: string | null;
  apiKeyRole?: WorkspaceRole;
  callingApplicationId?: string | null;
}

export type RequestAuthContext = JwtAuthContext | ApiKeyAuthContext;

/* ── Config ────────────────────────────────────────────────── */

export interface AppConfig {
  port: number;
  aiManagerSupabase: {
    url: string;
    anonKey: string;
    serviceRoleKey: string;
  };
  devsAi: {
    baseUrl: string;
    apiKey: string | undefined;
    defaultModel: string;
  };
}

/* ── Rate Limits ───────────────────────────────────────────── */

export interface RateLimits {
  global: number;
  llm: number;
  auth: number;
  llmUser: number;
}

/* ── Express helpers ───────────────────────────────────────── */

export type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void | Response>;

/* ── Workspace Roles ───────────────────────────────────────── */

export type WorkspaceRole = 'owner' | 'admin' | 'member';

/* ── LLM Client Interface ─────────────────────────────────── */

export interface ChatCompletionUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

export interface ChatCompletionChoice {
  message: { content: string };
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  model?: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage | null;
  raw?: unknown;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmClient {
  chatCompletion(
    model: string,
    messages: ChatMessage[],
    options?: Record<string, unknown>,
  ): Promise<ChatCompletionResponse>;
  chatCompletionStream?(
    model: string,
    messages: ChatMessage[],
    options?: Record<string, unknown>,
  ): Promise<globalThis.Response>;
}

export interface PatchedResponse extends globalThis.Response {
  _abortTimer?: ReturnType<typeof setTimeout>;
  _abortController?: AbortController;
}

/* ── Provider / AI Profile shapes (from Supabase rows) ───── */

export interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string | null;
  is_active: boolean;
  request_timeout_ms?: number | null;
  created_at: string;
  updated_at?: string;
  workspace_id: string;
}

export interface AiProfileRow {
  id: string;
  name: string;
  provider_id: string;
  external_ai_id: string;
  description?: string | null;
  is_active: boolean;
  is_default?: boolean;
  profile_type?: string;
  mode?: string;
  runtime_options?: Record<string, unknown> | null;
  requires_user_credentials?: boolean;
  failover_provider_id?: string | null;
  failover_external_ai_id?: string | null;
  failover_runtime_options?: Record<string, unknown> | null;
  provider?: ProviderRow;
  failover_provider?: ProviderRow | null;
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

export interface ProcessingJobRow {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  ai_profile_id?: string | null;
  ai_profile?: AiProfileRow | null;
  is_active: boolean;
  config?: Record<string, unknown>;
  calling_application_id?: string | null;
  requires_user_credentials?: boolean;
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

export interface ChatSessionRow {
  id: string;
  ai_profile_id: string;
  processing_job_id?: string | null;
  workflow_id?: string | null;
  user_id: string;
  calling_application?: string;
  external_chat_id?: string | null;
  provider_type?: string;
  status: string;
  system_prompt?: string | null;
  message_count?: number;
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  workflow_variables?: Record<string, unknown>;
  uses_user_credentials?: boolean;
  processing_message_id?: string | null;
  processing_started_at?: string | null;
  ai_profile?: AiProfileRow;
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

export interface ChatMessageRow {
  id: string;
  chat_session_id: string;
  role: string;
  content: string;
  workflow_step_id?: string | null;
  rule_set_key?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  duration_ms?: number | null;
  first_token_ms?: number | null;
  workspace_id: string;
  created_at: string;
}

/* ── Workflow Variable Pipeline types ─────────────────────── */

export interface WorkflowInputVariable {
  name: string;
  label?: string;
  description?: string;
  required?: boolean;
}

export interface WorkflowConfig {
  inputVariables?: WorkflowInputVariable[];
  systemPrompt?: string;
  [key: string]: unknown;
}

export interface WorkflowStepConfig {
  inputMappings?: Record<string, string>;
  outputMappings?: Record<string, string>;
  [key: string]: unknown;
}

export interface WorkflowRow {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  ai_profile_id?: string | null;
  ai_profile?: AiProfileRow | null;
  config?: WorkflowConfig;
  is_active: boolean;
  steps?: WorkflowStepRow[];
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

export interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  processing_job_id: string;
  processing_job?: ProcessingJobRow | null;
  step_key: string;
  name: string;
  sort_order?: number;
  is_required?: boolean;
  depends_on?: string[];
  config?: WorkflowStepConfig;
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

export interface LlmModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  category?: string | null;
  is_active: boolean;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface CallingApplicationRow {
  id: string;
  display_name: string;
  workspace_id: string;
  created_at: string;
  updated_at?: string;
}

export interface AppSettingRow {
  key: string;
  value: unknown;
  description?: string | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface DiagnosticLogRow {
  id: string;
  processing_job_id?: string | null;
  chat_session_id?: string | null;
  calling_application?: string | null;
  status: string;
  auth_mode?: string | null;
  user_id?: string | null;
  input_text?: string | null;
  output_text?: string | null;
  formatted_text?: string | null;
  total_duration_ms?: number | null;
  llm_timing?: Record<string, unknown> | null;
  llm_response?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  workspace_id: string;
  created_at: string;
}

export interface ProcessingJobGroupRow {
  id: string;
  app_id?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  sort_order?: number;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface UserProviderCredentialRow {
  id: string;
  user_id: string;
  provider_id: string;
  api_key: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

/* ── Health Checker ────────────────────────────────────────── */

export interface HealthCheckProviderKeyRow {
  id: string;
  workspace_id: string;
  user_id: string;
  provider_id: string;
  name: string;
  api_key: string;
  is_active: boolean;
  provider?: ProviderRow;
  created_at: string;
  updated_at: string;
}

export interface HealthCheckProfileRow {
  id: string;
  workspace_id: string;
  provider_id: string;
  hc_provider_key_id: string;
  external_ai_id: string;
  name: string;
  description?: string | null;
  mode: string;
  profile_type: string;
  runtime_options: Record<string, unknown>;
  is_active: boolean;
  provider?: ProviderRow;
  hc_provider_key?: HealthCheckProviderKeyRow;
  created_at: string;
  updated_at: string;
}

export interface HealthCheckRow {
  id: string;
  workspace_id: string;
  health_check_profile_id: string;
  name: string;
  test_message: string;
  cadence_minutes: number;
  outage_cadence_minutes: number;
  is_active: boolean;
  last_run_at?: string | null;
  health_check_profile?: HealthCheckProfileRow;
  created_at: string;
  updated_at: string;
}

export interface HealthCheckRunRow {
  id: string;
  health_check_id: string;
  workspace_id: string;
  status: 'pass' | 'fail' | 'timeout' | 'error';
  response_time_ms?: number | null;
  error_message?: string | null;
  raw_response?: string | null;
  created_at: string;
}

export interface HealthCheckIncidentRow {
  id: string;
  health_check_id: string;
  workspace_id: string;
  started_at: string;
  resolved_at?: string | null;
  duration_seconds?: number | null;
  failed_run_count: number;
  last_error?: string | null;
  created_at: string;
}

/* ── Formatting Rules ──────────────────────────────────────── */

export interface FormattingRule {
  type: string;
  order?: number;
  options?: Record<string, unknown>;
}

export interface FormattingResult {
  formatted: string;
  steps: FormattingStep[];
}

export interface FormattingStep {
  type: string;
  label?: string;
  before: number;
  after: number;
  changed?: boolean;
  error?: string;
  rolledBack?: boolean;
  warning?: string;
}

/* ── Diagnostics ───────────────────────────────────────────── */

export interface DiagnosticFilters {
  processingJobId?: string | null;
  chatSessionId?: string | null;
  callingApplication?: string | null;
  status?: string | null;
  userId?: string | null;
  authMode?: string | null;
  limit?: number;
}

/* ── AI Manager Result ─────────────────────────────────────── */

export interface AiManagerResult {
  raw: string;
  formatted: string;
  formattingSteps: FormattingStep[];
  messageSent: string;
  metadata: {
    durationMs: number;
    model: string;
    usage: ChatCompletionUsage | null;
    finishReason: string | null;
    jobSlug: string | null;
    jobName: string | null;
    aiProfile: string;
    provider: string;
  };
  diagnostics?: unknown;
}

/* ── Attachment ────────────────────────────────────────────── */

export interface Attachment {
  url: string;
  mimeType: string;
  fileName: string;
}

/* ── Widget Health Check types ───────────────────────────── */

export interface WidgetHealthCheckRow {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  test_message: string;
  cadence_minutes: number;
  outage_cadence_minutes: number;
  is_active: boolean;
  last_run_at: string | null;
  max_retries: number;
  shadow_host_selector: string;
  launcher_selector: string;
  iframe_selector: string;
  input_selector: string;
  send_selector: string;
  response_selector: string;
  error_patterns: string[];
  page_load_timeout_ms: number | null;
  widget_load_timeout_ms: number | null;
  response_timeout_ms: number | null;
  capture_screenshot: boolean;
  created_at: string;
  updated_at: string;
}

export interface WidgetHcTimeouts {
  page_load_timeout_ms: number;
  widget_load_timeout_ms: number;
  response_timeout_ms: number;
  slow_page_load_ms: number;
  slow_widget_load_ms: number;
  slow_response_ms: number;
}

export interface WidgetHealthCheckRunRow {
  id: string;
  widget_health_check_id: string;
  workspace_id: string;
  status: 'pass' | 'fail' | 'timeout' | 'error' | 'warning';
  response_time_ms: number | null;
  page_load_time_ms: number | null;
  widget_load_time_ms: number | null;
  ai_response_time_ms: number | null;
  error_message: string | null;
  raw_response: string | null;
  screenshot_path: string | null;
  created_at: string;
}

export interface WidgetHealthCheckIncidentRow {
  id: string;
  widget_health_check_id: string;
  workspace_id: string;
  started_at: string;
  resolved_at: string | null;
  duration_seconds: number | null;
  failed_run_count: number;
  last_error: string | null;
  created_at: string;
}
