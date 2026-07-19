export interface Provider {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key?: string;
  /** Present on API responses — api_key is stripped for security */
  has_api_key?: boolean;
  is_active: boolean;
  request_timeout_ms: number | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface AiProfile {
  id: string;
  name: string;
  provider_id: string;
  external_ai_id: string;
  description?: string | null;
  is_active: boolean;
  is_default: boolean;
  profile_type?: string;
  mode?: string;
  runtime_options?: Record<string, unknown> | null;
  requires_user_credentials?: boolean;
  failover_provider_id?: string | null;
  failover_external_ai_id?: string | null;
  failover_runtime_options?: Record<string, unknown> | null;
  provider?: Provider;
  failover_provider?: Provider | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  config?: Record<string, unknown> | null;
}

export interface ProcessingJob {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  ai_profile_id?: string | null;
  ai_profile?: AiProfile | null;
  is_active: boolean;
  config?: ProcessingJobConfig;
  calling_application_id?: string | null;
  requires_user_credentials?: boolean;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  sessionId?: string;
  ai_profile_id: string;
  processing_job_id?: string | null;
  workflow_id?: string | null;
  workflow_variables?: Record<string, unknown> | null;
  user_id: string;
  calling_application?: string;
  status: string;
  system_prompt?: string | null;
  message_count?: number;
  total_prompt_tokens?: number;
  total_completion_tokens?: number;
  uses_user_credentials?: boolean;
  ai_profile?: AiProfile;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  chat_session_id: string;
  role: string;
  content: string;
  workflow_step_id?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  duration_ms?: number | null;
  first_token_ms?: number | null;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  display_name?: string | null;
  last_sign_in_at?: string | null;
}

export interface WorkspaceMembership {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  workspace?: Workspace;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  key_prefix?: string;
  last_used_at?: string | null;
  workspace_id: string;
  created_at: string;
}

export interface CreateApiKeyResponse extends ApiKey {
  secret: string;
}

export interface AppSetting {
  key: string;
  value: Record<string, unknown>;
  workspace_id: string;
}

export interface CallingApplication {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  display_name?: string;
  is_active: boolean;
  workspace_id: string;
  created_at: string;
}

/* ── Workflow Variable Pipeline types ────────────────────── */

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

export interface Workflow {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  ai_profile_id?: string | null;
  config?: WorkflowConfig;
  is_active: boolean;
  steps?: WorkflowStep[];
  workspace_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowStep {
  id?: string;
  workflow_id?: string;
  processing_job_id: string;
  step_key: string;
  name: string;
  sort_order?: number;
  is_required?: boolean;
  depends_on?: string[];
  config?: WorkflowStepConfig;
  workspace_id?: string;
}

export interface DiagnosticLog {
  id: string;
  processing_job_id?: string;
  chat_session_id?: string;
  calling_application?: string;
  status: string;
  total_duration_ms?: number;
  request_payload?: Record<string, unknown>;
  supabase_timing?: Record<string, unknown>[];
  llm_timing?: Record<string, unknown>;
  llm_request?: Record<string, unknown>;
  llm_response?: Record<string, unknown>;
  formatting_timing?: Record<string, unknown>;
  error_message?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ProcessingJobGroup {
  id: string;
  name: string;
  slug: string;
  sort_order?: number;
  app_id?: string;
  workspace_id: string;
}

export interface LlmModel {
  id: string;
  provider_id: string;
  model_id: string;
  external_model_id?: string;
  display_name: string;
  category?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface SyncModelsResult {
  synced: number;
  discovered: number;
  discoveryNote?: string;
  refreshedAt?: string;
}

export interface HealthCheckResult {
  status: string;
  tables: Record<string, boolean>;
}

/* ── Health Checker types ────────────────────────────────── */

export interface HcProviderKey {
  id: string;
  workspace_id: string;
  user_id: string;
  provider_id: string;
  name: string;
  is_active: boolean;
  provider?: Provider;
  created_at: string;
  updated_at: string;
}

export interface HcProfile {
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
  provider?: Provider;
  hc_provider_key?: HcProviderKey;
  created_at: string;
  updated_at: string;
}

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface HcCheck {
  id: string;
  workspace_id: string;
  health_check_profile_id: string;
  name: string;
  test_message: string;
  cadence_minutes: number;
  outage_cadence_minutes: number;
  is_active: boolean;
  last_run_at?: string | null;
  health_check_profile?: HcProfile;
  healthStatus?: HealthStatus;
  created_at: string;
  updated_at: string;
}

export interface HcRun {
  id: string;
  health_check_id: string;
  workspace_id: string;
  status: 'pass' | 'fail' | 'timeout' | 'error';
  response_time_ms?: number | null;
  error_message?: string | null;
  raw_response?: string | null;
  created_at: string;
}

export interface HcIncident {
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

export type HcSemaphore = 'green' | 'yellow' | 'red' | 'gray';

export interface HcDashboardItem {
  id: string;
  name: string;
  profileName: string | null;
  providerName: string | null;
  cadenceMinutes: number;
  outageCadenceMinutes: number;
  isActive: boolean;
  lastRunAt: string | null;
  semaphore: HcSemaphore;
  lastRun: HcRun | null;
  recentRuns: HcRun[];
  activeIncident: HcIncident | null;
}

export interface UserCredential {
  id: string;
  provider_id: string;
  label?: string | null;
  created_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
}

/* ── Processing Job Config sub-types ────────────────────── */

export interface JobVariable {
  name: string;
  label?: string;
  description?: string;
  source?: string;
}

export interface SchemaFieldDef {
  description?: string;
  type?: string;
  required?: boolean;
}

export interface ExpectedSchema {
  fields?: Record<string, SchemaFieldDef>;
}

export interface ProcessingJobConfig {
  promptTemplate?: string;
  variables?: JobVariable[];
  testData?: Record<string, string>;
  expectedSchema?: ExpectedSchema;
  formattingRules?: Record<string, unknown>[];
  [key: string]: unknown;
}

/* ── Formatting rules catalogue (GET /processing-jobs/formatting-rules) ── */

export interface AvailableFormattingRule {
  type: string;
  label: string;
  description: string;
  hasOptions: boolean;
  streamingSafe: boolean;
  streamingNote: string;
}

/* ── AI Matcher result types ────────────────────────────── */

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface FormattingStep {
  type: string;
  label?: string;
  changed?: boolean;
}

export interface AiMatcherSlotResult {
  slotIndex: number;
  status: 'success' | 'error';
  raw: string | null;
  formatted: string | null;
  formattingSteps: FormattingStep[] | null;
  durationMs: number | null;
  model: string;
  provider: string | null;
  profileName: string | null;
  usage: TokenUsage | null;
  finishReason: string | null;
  error?: string;
}

/* ── Uptime History ──────────────────────────────────────── */

export interface UptimeDay {
  date: string;
  totalRuns: number;
  passCount: number;
  failCount: number;
  timeoutCount: number;
  errorCount: number;
  warningCount: number;
}

export interface UptimeTotals {
  pass: number;
  fail: number;
  timeout: number;
  error: number;
  warning: number;
}

export interface CheckUptimeHistory {
  checkId: string;
  checkName: string;
  checkType: 'api';
  uptimePercent: number | null;
  totals: UptimeTotals;
  dailyStats: UptimeDay[];
}

/* ── Run List with Total ─────────────────────────────────── */

export interface RunListResponse<T> {
  data: T[];
  total: number;
}

/* ── Failure Patterns ────────────────────────────────────── */

export interface ErrorGroup {
  error_message: string;
  count: number;
}

export interface HourlyCount {
  hour: number;
  count: number;
}

export interface FailurePatterns {
  error_groups: ErrorGroup[];
  hourly_distribution: HourlyCount[];
}
