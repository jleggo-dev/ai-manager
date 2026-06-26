/**
 * Widget HC Timeout Resolution
 * Reads the global `widget_hc_timeouts` setting from app_settings,
 * then merges per-check overrides on top.
 */

import { getServiceSupabase } from '../db/service-supabase.ts';
import type { WidgetHealthCheckRow, WidgetHcTimeouts } from '../types.ts';

const SETTINGS_KEY = 'widget_hc_timeouts';

export const DEFAULT_WIDGET_HC_TIMEOUTS: WidgetHcTimeouts = {
  page_load_timeout_ms: 60_000,
  widget_load_timeout_ms: 30_000,
  response_timeout_ms: 60_000,
  slow_page_load_ms: 15_000,
  slow_widget_load_ms: 10_000,
  slow_response_ms: 30_000,
};

export async function getGlobalTimeouts(workspaceId: string): Promise<WidgetHcTimeouts> {
  try {
    const sb = getServiceSupabase();
    const { data } = await sb
      .from('app_settings')
      .select('value')
      .eq('workspace_id', workspaceId)
      .eq('key', SETTINGS_KEY)
      .maybeSingle();

    if (!data?.value || typeof data.value !== 'object') {
      return { ...DEFAULT_WIDGET_HC_TIMEOUTS };
    }

    const v = data.value as Record<string, unknown>;
    return {
      page_load_timeout_ms: asPositiveInt(v.page_load_timeout_ms) ?? DEFAULT_WIDGET_HC_TIMEOUTS.page_load_timeout_ms,
      widget_load_timeout_ms:
        asPositiveInt(v.widget_load_timeout_ms) ?? DEFAULT_WIDGET_HC_TIMEOUTS.widget_load_timeout_ms,
      response_timeout_ms: asPositiveInt(v.response_timeout_ms) ?? DEFAULT_WIDGET_HC_TIMEOUTS.response_timeout_ms,
      slow_page_load_ms: asPositiveInt(v.slow_page_load_ms) ?? DEFAULT_WIDGET_HC_TIMEOUTS.slow_page_load_ms,
      slow_widget_load_ms: asPositiveInt(v.slow_widget_load_ms) ?? DEFAULT_WIDGET_HC_TIMEOUTS.slow_widget_load_ms,
      slow_response_ms: asPositiveInt(v.slow_response_ms) ?? DEFAULT_WIDGET_HC_TIMEOUTS.slow_response_ms,
    };
  } catch {
    return { ...DEFAULT_WIDGET_HC_TIMEOUTS };
  }
}

/**
 * Resolve effective timeouts: per-check overrides > global defaults > hardcoded defaults.
 */
export async function resolveTimeouts(check: WidgetHealthCheckRow): Promise<WidgetHcTimeouts> {
  const global = await getGlobalTimeouts(check.workspace_id);
  return {
    page_load_timeout_ms: check.page_load_timeout_ms ?? global.page_load_timeout_ms,
    widget_load_timeout_ms: check.widget_load_timeout_ms ?? global.widget_load_timeout_ms,
    response_timeout_ms: check.response_timeout_ms ?? global.response_timeout_ms,
    slow_page_load_ms: global.slow_page_load_ms,
    slow_widget_load_ms: global.slow_widget_load_ms,
    slow_response_ms: global.slow_response_ms,
  };
}

function asPositiveInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  return undefined;
}
