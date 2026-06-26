/**
 * E2E: Schema Validation
 * ----------------------
 * Connects to the real Supabase DB and verifies that every column
 * referenced in TypeScript row interfaces actually exists in the
 * production schema. Catches migration drift before it reaches runtime.
 *
 * This test uses select(column).limit(0) via PostgREST — if the column
 * doesn't exist, PostgREST returns an error. If it does, data is [].
 */
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.AI_MANAGER_SUPABASE_URL ?? '';
const key = process.env.AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY ?? '';

const TABLE_COLUMNS: Record<string, string[]> = {
  chat_sessions: [
    'id',
    'ai_profile_id',
    'processing_job_id',
    'workflow_id',
    'user_id',
    'calling_application',
    'external_chat_id',
    'provider_type',
    'status',
    'system_prompt',
    'message_count',
    'total_prompt_tokens',
    'total_completion_tokens',
    'workflow_variables',
    'uses_user_credentials',
    'processing_message_id',
    'processing_started_at',
    'workspace_id',
    'created_at',
    'updated_at',
  ],
  chat_messages: [
    'id',
    'chat_session_id',
    'role',
    'content',
    'workflow_step_id',
    'rule_set_key',
    'prompt_tokens',
    'completion_tokens',
    'duration_ms',
    'first_token_ms',
    'workspace_id',
    'created_at',
  ],
  processing_jobs: [
    'id',
    'name',
    'slug',
    'description',
    'ai_profile_id',
    'is_active',
    'config',
    'calling_application_id',
    'requires_user_credentials',
    'workspace_id',
    'created_at',
    'updated_at',
  ],
  ai_profiles: [
    'id',
    'name',
    'provider_id',
    'external_ai_id',
    'description',
    'is_active',
    'is_default',
    'profile_type',
    'mode',
    'runtime_options',
    'requires_user_credentials',
    'failover_provider_id',
    'failover_external_ai_id',
    'failover_runtime_options',
    'workspace_id',
    'created_at',
    'updated_at',
  ],
  providers: [
    'id',
    'name',
    'type',
    'base_url',
    'api_key',
    'is_active',
    'request_timeout_ms',
    'workspace_id',
    'created_at',
    'updated_at',
  ],
  api_keys: [
    'id',
    'name',
    'key_prefix',
    'key_hash',
    'created_by',
    'last_used_at',
    'role',
    'calling_application_id',
    'workspace_id',
    'created_at',
    'updated_at',
  ],
  diagnostic_logs: [
    'id',
    'processing_job_id',
    'chat_session_id',
    'calling_application',
    'status',
    'user_id',
    'auth_mode',
    'api_key_id',
    'request_payload',
    'supabase_timing',
    'llm_timing',
    'llm_request',
    'llm_response',
    'formatting_timing',
    'total_duration_ms',
    'error_message',
    'metadata',
    'workspace_id',
    'created_at',
  ],
  calling_applications: ['id', 'display_name', 'workspace_id', 'created_at'],
  user_provider_credentials: [
    'id',
    'user_id',
    'provider_id',
    'api_key',
    'label',
    'metadata',
    'workspace_id',
    'created_at',
    'updated_at',
  ],
  workflows: [
    'id',
    'name',
    'slug',
    'description',
    'ai_profile_id',
    'config',
    'is_active',
    'workspace_id',
    'created_at',
    'updated_at',
  ],
  workflow_steps: [
    'id',
    'workflow_id',
    'processing_job_id',
    'step_key',
    'name',
    'sort_order',
    'is_required',
    'depends_on',
    'config',
    'workspace_id',
    'created_at',
    'updated_at',
  ],
};

const supabase = createClient(url, key);

describe('E2E: Schema Validation — every code-referenced column exists in DB', () => {
  for (const [table, expectedColumns] of Object.entries(TABLE_COLUMNS)) {
    describe(`table: ${table}`, () => {
      it('table is accessible', async () => {
        const { error } = await supabase.from(table).select('*').limit(0);
        expect(error, `Table "${table}" is not accessible`).toBeNull();
      });

      for (const col of expectedColumns) {
        it(`column "${col}" exists`, async () => {
          const { error } = await supabase.from(table).select(col).limit(0);
          expect(error, `Column "${table}.${col}" does not exist`).toBeNull();
        });
      }
    });
  }

  it('RPC merge_workflow_variables exists and is callable', async () => {
    const { error } = await supabase.rpc('merge_workflow_variables', {
      p_session_id: '00000000-0000-0000-0000-000000000000',
      p_new_vars: {},
    });
    if (error) {
      expect(error.message).not.toContain('does not exist');
    }
  });
});
