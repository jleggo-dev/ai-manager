import { getServiceSupabase } from './service-supabase.ts';

let _cachedId: string | null = null;

/** UUID of the workspace with slug `default` (cached). */
export async function getDefaultWorkspaceId(): Promise<string> {
  if (_cachedId) return _cachedId;
  const svc = getServiceSupabase();
  const { data, error } = await svc.from('workspaces').select('id').eq('slug', 'default').maybeSingle();
  if (error) throw new Error(`default workspace: ${error.message}`);
  if (!data?.id) throw new Error("No workspace with slug 'default' — run migration 003");
  _cachedId = data.id as string;
  return _cachedId;
}
