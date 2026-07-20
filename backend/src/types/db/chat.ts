import type { AiProfileRow } from './providers-and-profiles.ts';

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
  config?: Record<string, unknown> | null;
  session_summary?: string | null;
  provider_metadata?: Record<string, unknown> | null;
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
