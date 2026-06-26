/**
 * Model – Widget Health Checks
 * -----------------------------
 * CRUD for widget_health_checks, widget_health_check_runs,
 * and widget_health_check_incidents.
 */

import { tenantFrom, tenantInsertPayload, tenantClient, requireWorkspaceId } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import type { WidgetHealthCheckRow, WidgetHealthCheckRunRow, WidgetHealthCheckIncidentRow } from '../types.ts';

/* ── Widget Checks ───────────────────────────────────────── */

export async function createWidgetCheck(data: Partial<WidgetHealthCheckRow>): Promise<WidgetHealthCheckRow> {
  const payload: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() };
  const { data: row, error } = await tenantFrom('widget_health_checks')
    .insert(tenantInsertPayload(payload))
    .select('*')
    .single();
  if (error) throw new Error(`Widget check insert error: ${error.message}`);
  return row;
}

export async function updateWidgetCheck(
  id: string,
  updates: Partial<WidgetHealthCheckRow>,
): Promise<WidgetHealthCheckRow> {
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
  const { data: row, error } = await tenantFrom('widget_health_checks')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(`Widget check update error: ${error.message}`);
  return row;
}

export async function listWidgetChecks(): Promise<WidgetHealthCheckRow[]> {
  const { data, error } = await tenantFrom('widget_health_checks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Widget check list error: ${error.message}`);
  return data || [];
}

export async function getWidgetCheck(id: string): Promise<WidgetHealthCheckRow> {
  const { data: row, error } = await tenantFrom('widget_health_checks').select('*').eq('id', id).single();
  if (error) throw new Error(`Widget check get error: ${error.message}`);
  return row;
}

export async function deleteWidgetCheck(id: string): Promise<void> {
  const { error } = await tenantFrom('widget_health_checks').delete().eq('id', id);
  if (error) throw new Error(`Widget check delete error: ${error.message}`);
}

/* ── Widget Check Runs ───────────────────────────────────── */

export async function getWidgetRun(runId: string): Promise<WidgetHealthCheckRunRow> {
  const { data: row, error } = await tenantFrom('widget_health_check_runs').select('*').eq('id', runId).single();
  if (error) throw new Error(`Widget run get error: ${error.message}`);
  return row;
}

import type { RunListOptions } from './run-list-options.ts';

export async function listWidgetRuns(
  checkId: string,
  options: RunListOptions = {},
): Promise<WidgetHealthCheckRunRow[]> {
  const limit = options.limit || 50;
  let query = tenantFrom('widget_health_check_runs').select('*').eq('widget_health_check_id', checkId);

  if (options.status?.length) query = query.in('status', options.status);
  if (options.from) query = query.gte('created_at', options.from);
  if (options.to) query = query.lte('created_at', options.to);

  query = query.order('created_at', { ascending: false });
  if (options.offset) query = query.range(options.offset, options.offset + limit - 1);
  else query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`Widget run list error: ${error.message}`);
  return data || [];
}

export async function countWidgetRuns(
  checkId: string,
  options: Pick<RunListOptions, 'status' | 'from' | 'to'> = {},
): Promise<number> {
  let query = tenantFrom('widget_health_check_runs')
    .select('*', { count: 'exact', head: true })
    .eq('widget_health_check_id', checkId);

  if (options.status?.length) query = query.in('status', options.status);
  if (options.from) query = query.gte('created_at', options.from);
  if (options.to) query = query.lte('created_at', options.to);

  const { count, error } = await query;
  if (error) throw new Error(`Widget run count error: ${error.message}`);
  return count ?? 0;
}

/* ── Daily Aggregation (RPC) ──────────────────────────────── */

export interface WidgetDailyRunSummaryRow {
  run_date: string;
  total_runs: number;
  pass_count: number;
  fail_count: number;
  timeout_count: number;
  error_count: number;
  warning_count: number;
}

export async function getWidgetDailyRunSummary(
  checkId: string,
  startDate: string,
  endDate: string,
): Promise<WidgetDailyRunSummaryRow[]> {
  const { data, error } = await tenantClient().rpc('widget_hc_daily_run_summary', {
    p_check_id: checkId,
    p_start: startDate,
    p_end: endDate,
    p_workspace_id: requireWorkspaceId(),
  });
  if (error) throw new Error(`widget_hc_daily_run_summary RPC error: ${error.message}`);
  return (data as WidgetDailyRunSummaryRow[]) || [];
}

/* ── Failure Patterns (RPC) ───────────────────────────────── */

export interface WidgetFailurePatternsResult {
  error_groups: { error_message: string; count: number }[];
  hourly_distribution: { hour: number; count: number }[];
}

export async function getWidgetFailurePatterns(
  checkId: string,
  startDate: string,
  endDate: string,
): Promise<WidgetFailurePatternsResult> {
  const wsId = requireWorkspaceId();
  const { data, error } = await tenantClient().rpc('widget_hc_failure_patterns', {
    p_check_id: checkId,
    p_start: startDate,
    p_end: endDate,
    p_workspace_id: wsId,
  });
  if (error) throw new Error(`widget_hc_failure_patterns RPC error: ${error.message}`);
  return (data as WidgetFailurePatternsResult) ?? { error_groups: [], hourly_distribution: [] };
}

/* ── Widget Check Incidents ──────────────────────────────── */

export async function listWidgetIncidents(
  checkId: string,
  options: { limit?: number } = {},
): Promise<WidgetHealthCheckIncidentRow[]> {
  const limit = options.limit || 20;
  const { data, error } = await tenantFrom('widget_health_check_incidents')
    .select('*')
    .eq('widget_health_check_id', checkId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Widget incident list error: ${error.message}`);
  return data || [];
}

export async function getOpenWidgetIncident(checkId: string): Promise<WidgetHealthCheckIncidentRow | null> {
  const { data, error } = await tenantFrom('widget_health_check_incidents')
    .select('*')
    .eq('widget_health_check_id', checkId)
    .is('resolved_at', null)
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Widget incident get error: ${error.message}`);
  return data?.[0] || null;
}

/* ── Service-role helpers (used by the scheduler) ─────────── */

export async function listDueWidgetChecks(): Promise<WidgetHealthCheckRow[]> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('widget_health_checks')
    .select('*')
    .eq('is_active', true)
    .or('last_run_at.is.null,last_run_at.lt.' + new Date(Date.now() - 60_000).toISOString());
  if (error) throw new Error(`listDueWidgetChecks error: ${error.message}`);

  const rows = data || [];
  if (rows.length === 0) return [];

  const checkIds = rows.map((r) => r.id);
  const { data: openIncidents } = await sb
    .from('widget_health_check_incidents')
    .select('widget_health_check_id')
    .in('widget_health_check_id', checkIds)
    .is('resolved_at', null);

  const incidentSet = new Set((openIncidents || []).map((i) => i.widget_health_check_id));

  return rows.filter((row) => {
    if (!row.last_run_at) return true;
    const elapsed = Date.now() - new Date(row.last_run_at).getTime();
    const cadence = incidentSet.has(row.id) ? (row.outage_cadence_minutes ?? row.cadence_minutes) : row.cadence_minutes;
    return elapsed >= cadence * 60_000;
  });
}

export async function serviceInsertWidgetRun(
  data: Omit<WidgetHealthCheckRunRow, 'id' | 'created_at'>,
): Promise<WidgetHealthCheckRunRow> {
  const sb = getServiceSupabase();
  const { data: row, error } = await sb.from('widget_health_check_runs').insert(data).select().single();
  if (error) throw new Error(`Widget run insert (service) error: ${error.message}`);
  return row;
}

export async function serviceUpdateWidgetCheckLastRun(id: string): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb
    .from('widget_health_checks')
    .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`Widget check update last_run_at error: ${error.message}`);
}

export async function serviceGetOpenWidgetIncident(checkId: string): Promise<WidgetHealthCheckIncidentRow | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('widget_health_check_incidents')
    .select('*')
    .eq('widget_health_check_id', checkId)
    .is('resolved_at', null)
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`serviceGetOpenWidgetIncident error: ${error.message}`);
  return data?.[0] || null;
}

export async function serviceOpenWidgetIncident(
  checkId: string,
  workspaceId: string,
  errorMessage: string | null,
): Promise<WidgetHealthCheckIncidentRow> {
  const sb = getServiceSupabase();
  const { data: row, error } = await sb
    .from('widget_health_check_incidents')
    .insert({
      widget_health_check_id: checkId,
      workspace_id: workspaceId,
      last_error: errorMessage,
    })
    .select()
    .single();
  if (error) throw new Error(`serviceOpenWidgetIncident error: ${error.message}`);
  return row;
}

export async function serviceUpdateWidgetIncident(
  incidentId: string,
  updates: Partial<WidgetHealthCheckIncidentRow>,
): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb.from('widget_health_check_incidents').update(updates).eq('id', incidentId);
  if (error) throw new Error(`serviceUpdateWidgetIncident error: ${error.message}`);
}

export async function serviceResolveWidgetIncident(incidentId: string, startedAt: string): Promise<void> {
  const now = new Date();
  const durationSeconds = Math.round((now.getTime() - new Date(startedAt).getTime()) / 1000);
  const sb = getServiceSupabase();
  const { error } = await sb
    .from('widget_health_check_incidents')
    .update({
      resolved_at: now.toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq('id', incidentId);
  if (error) throw new Error(`serviceResolveWidgetIncident error: ${error.message}`);
}
