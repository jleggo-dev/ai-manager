/**
 * Mirrors `diagnostic_logs` columns (see e2e-schema-validation).
 * JSONB columns stay as `Record` at the row boundary; the frontend may
 * narrow nested shapes for UI consumption.
 */
export interface DiagnosticLogRow {
  id: string;
  processing_job_id?: string | null;
  chat_session_id?: string | null;
  calling_application?: string | null;
  status: string;
  user_id?: string | null;
  auth_mode?: string | null;
  api_key_id?: string | null;
  request_payload?: Record<string, unknown> | null;
  supabase_timing?: Record<string, unknown>[] | null;
  llm_timing?: Record<string, unknown> | null;
  llm_request?: Record<string, unknown> | null;
  llm_response?: Record<string, unknown> | null;
  formatting_timing?: Record<string, unknown> | null;
  total_duration_ms?: number | null;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
  workspace_id: string;
  created_at: string;
}

export interface DiagnosticFilters {
  processingJobId?: string | null;
  chatSessionId?: string | null;
  callingApplication?: string | null;
  status?: string | null;
  userId?: string | null;
  authMode?: string | null;
  limit?: number;
}
