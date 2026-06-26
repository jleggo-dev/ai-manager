/**
 * Legacy entry + health check using service role (no user session).
 */
import { getServiceSupabase } from './service-supabase.ts';

export { getServiceSupabase };

/**
 * Health check for AI Manager tables (startup diagnostics).
 */
export async function healthCheck(): Promise<Record<string, boolean>> {
  const supabase = getServiceSupabase();
  const results: Record<string, boolean> = {};
  const tables = [
    'providers',
    'ai_profiles',
    'processing_jobs',
    'processing_job_groups',
    'diagnostic_logs',
    'workspaces',
    'workspace_members',
    'app_settings',
    'api_keys',
    'calling_applications',
    'workflows',
    'workflow_steps',
  ] as const;
  for (const table of tables) {
    try {
      const col = table === 'app_settings' ? 'key' : 'id';
      const { error } = await supabase.from(table).select(col).limit(1);
      results[table] = !error;
    } catch {
      results[table] = false;
    }
  }
  return results;
}
