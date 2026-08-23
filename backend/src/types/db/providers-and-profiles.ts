export interface ProviderRow {
  id: string;
  name: string;
  type: string;
  base_url: string;
  api_key: string | null;
  is_active: boolean;
  request_timeout_ms?: number | null;
  /** Max characters of one tool result under this provider. NULL = inherit the app default. */
  max_tool_output_chars?: number | null;
  created_at: string;
  updated_at?: string;
  workspace_id: string;
}

export interface AiProfileRow {
  id: string;
  name: string;
  slug?: string | null;
  provider_id: string;
  external_ai_id: string;
  description?: string | null;
  is_active: boolean;
  is_default?: boolean;
  profile_type?: string;
  mode?: string;
  runtime_options?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
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

/** Mirrors `calling_applications` columns (see e2e-schema-validation). */
export interface CallingApplicationRow {
  id: string;
  display_name: string;
  workspace_id: string;
  created_at: string;
}

export interface AppSettingRow {
  key: string;
  value: unknown;
  description?: string | null;
  workspace_id: string;
  created_at: string;
  updated_at: string;
}
