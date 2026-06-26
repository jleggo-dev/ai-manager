/**
 * Cached reader for rate-limit settings stored in app_settings.
 *
 * Rate limiting runs before auth context is established, so this module
 * reads directly from the DB using the service-role client and the
 * default workspace. Values are cached with a 60-second TTL.
 */

import { getServiceSupabase } from '../db/service-supabase.ts';
import { getDefaultWorkspaceId } from '../db/workspace-default.ts';
import { errorMessage } from './error-message.ts';
import type { RateLimits } from '../types.ts';

const CACHE_TTL_MS = 60_000;

const DEFAULTS: RateLimits = { global: 600, llm: 60, auth: 30, llmUser: 30 } as const;
const SETTING_KEYS = {
  global: 'rate_limit_global_rpm',
  llm: 'rate_limit_llm_rpm',
  auth: 'rate_limit_auth_rpm',
  llmUser: 'rate_limit_llm_user_rpm',
} as const;

let _cached: RateLimits = { ...DEFAULTS };
let _cacheExpiry = 0;

async function refresh(): Promise<void> {
  try {
    const workspaceId = await getDefaultWorkspaceId();
    const svc = getServiceSupabase();
    const keys = Object.values(SETTING_KEYS);
    const { data, error } = await svc
      .from('app_settings')
      .select('key, value')
      .eq('workspace_id', workspaceId)
      .in('key', keys);

    if (error) {
      console.warn('[rate-limit-settings] DB read failed, using cached/defaults:', error.message);
      return;
    }

    const byKey = Object.fromEntries((data || []).map((r: { key: string; value: unknown }) => [r.key, r.value]));

    _cached = {
      global: Number(byKey[SETTING_KEYS.global]) || DEFAULTS.global,
      llm: Number(byKey[SETTING_KEYS.llm]) || DEFAULTS.llm,
      auth: Number(byKey[SETTING_KEYS.auth]) || DEFAULTS.auth,
      llmUser: Number(byKey[SETTING_KEYS.llmUser]) || DEFAULTS.llmUser,
    };
    _cacheExpiry = Date.now() + CACHE_TTL_MS;
  } catch (err: unknown) {
    console.warn('[rate-limit-settings] Refresh failed, using cached/defaults:', errorMessage(err));
    _cacheExpiry = Date.now() + 5_000;
  }
}

export async function getRateLimits(): Promise<RateLimits> {
  if (Date.now() >= _cacheExpiry) await refresh();
  return _cached;
}
