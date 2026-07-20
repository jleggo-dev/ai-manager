import type { ProviderRow } from './providers-and-profiles.ts';

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
