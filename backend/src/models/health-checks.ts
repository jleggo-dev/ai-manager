/**
 * Model – Health Checks
 * ----------------------
 * CRUD for health_check_provider_keys, health_check_profiles,
 * health_checks, health_check_runs, and health_check_incidents.
 */

import {
  tenantFrom,
  tenantInsertPayload,
  tenantClient,
  getAuthContext,
  effectiveUserId,
  requireWorkspaceId,
} from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import { encryptSecret, decryptSecret } from '../lib/crypto.ts';
import type {
  HealthCheckProviderKeyRow,
  HealthCheckProfileRow,
  HealthCheckRow,
  HealthCheckRunRow,
  HealthCheckIncidentRow,
} from '../types.ts';

async function resolveUserId(): Promise<string> {
  const uid = effectiveUserId(getAuthContext());
  if (uid) return uid;

  const wsId = requireWorkspaceId();
  const { data } = await getServiceSupabase()
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', wsId)
    .in('role', ['owner', 'admin'])
    .order('role', { ascending: true })
    .limit(1)
    .single();
  if (data?.user_id) return data.user_id as string;

  throw new Error('Cannot determine user identity for provider key ownership');
}

function decryptKeyRow(row: HealthCheckProviderKeyRow): HealthCheckProviderKeyRow {
  if (row?.api_key) {
    try {
      return { ...row, api_key: decryptSecret(row.api_key) };
    } catch {
      return row;
    }
  }
  return row;
}

/* ── Provider Keys ────────────────────────────────────────── */

export async function createProviderKey(data: Partial<HealthCheckProviderKeyRow>): Promise<HealthCheckProviderKeyRow> {
  const userId = await resolveUserId();
  const payload: Record<string, unknown> = { ...data, user_id: userId, updated_at: new Date().toISOString() };
  if (payload.api_key) payload.api_key = encryptSecret(payload.api_key as string);
  const { data: row, error } = await tenantFrom('health_check_provider_keys')
    .insert(tenantInsertPayload(payload))
    .select('*, provider:providers(*)')
    .single();
  if (error) throw new Error(`HC provider key insert error: ${error.message}`);
  return decryptKeyRow(row);
}

export async function updateProviderKey(
  id: string,
  updates: Partial<HealthCheckProviderKeyRow>,
): Promise<HealthCheckProviderKeyRow> {
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
  if (payload.api_key) payload.api_key = encryptSecret(payload.api_key as string);
  const { data: row, error } = await tenantFrom('health_check_provider_keys')
    .update(payload)
    .eq('id', id)
    .select('*, provider:providers(*)')
    .single();
  if (error) throw new Error(`HC provider key update error: ${error.message}`);
  return decryptKeyRow(row);
}

export async function listProviderKeys(): Promise<HealthCheckProviderKeyRow[]> {
  const { data, error } = await tenantFrom('health_check_provider_keys')
    .select('*, provider:providers(*)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`HC provider key list error: ${error.message}`);
  return (data || []).map(decryptKeyRow);
}

export async function getProviderKey(id: string): Promise<HealthCheckProviderKeyRow> {
  const { data: row, error } = await tenantFrom('health_check_provider_keys')
    .select('*, provider:providers(*)')
    .eq('id', id)
    .single();
  if (error) throw new Error(`HC provider key get error: ${error.message}`);
  return decryptKeyRow(row);
}

export async function deleteProviderKey(id: string): Promise<void> {
  const { error } = await tenantFrom('health_check_provider_keys').delete().eq('id', id);
  if (error) throw new Error(`HC provider key delete error: ${error.message}`);
}

/* ── Profiles ─────────────────────────────────────────────── */

export async function createHcProfile(data: Partial<HealthCheckProfileRow>): Promise<HealthCheckProfileRow> {
  const payload: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() };
  const { data: row, error } = await tenantFrom('health_check_profiles')
    .insert(tenantInsertPayload(payload))
    .select('*, provider:providers(*), hc_provider_key:health_check_provider_keys(*)')
    .single();
  if (error) throw new Error(`HC profile insert error: ${error.message}`);
  return row;
}

export async function updateHcProfile(
  id: string,
  updates: Partial<HealthCheckProfileRow>,
): Promise<HealthCheckProfileRow> {
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
  const { data: row, error } = await tenantFrom('health_check_profiles')
    .update(payload)
    .eq('id', id)
    .select('*, provider:providers(*), hc_provider_key:health_check_provider_keys(*)')
    .single();
  if (error) throw new Error(`HC profile update error: ${error.message}`);
  return row;
}

export async function listHcProfiles(): Promise<HealthCheckProfileRow[]> {
  const { data, error } = await tenantFrom('health_check_profiles')
    .select('*, provider:providers(*), hc_provider_key:health_check_provider_keys(*)')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`HC profile list error: ${error.message}`);
  return data || [];
}

export async function getHcProfile(id: string): Promise<HealthCheckProfileRow> {
  const { data: row, error } = await tenantFrom('health_check_profiles')
    .select('*, provider:providers(*), hc_provider_key:health_check_provider_keys(*)')
    .eq('id', id)
    .single();
  if (error) throw new Error(`HC profile get error: ${error.message}`);
  return row;
}

export async function deleteHcProfile(id: string): Promise<void> {
  const { error } = await tenantFrom('health_check_profiles').delete().eq('id', id);
  if (error) throw new Error(`HC profile delete error: ${error.message}`);
}

/* ── Health Checks ────────────────────────────────────────── */

const HC_CHECK_SELECT =
  '*, health_check_profile:health_check_profiles(*, provider:providers(*), hc_provider_key:health_check_provider_keys(*))';

export async function createHealthCheck(data: Partial<HealthCheckRow>): Promise<HealthCheckRow> {
  const payload: Record<string, unknown> = { ...data, updated_at: new Date().toISOString() };
  const { data: row, error } = await tenantFrom('health_checks')
    .insert(tenantInsertPayload(payload))
    .select(HC_CHECK_SELECT)
    .single();
  if (error) throw new Error(`Health check insert error: ${error.message}`);
  return row;
}

export async function updateHealthCheck(id: string, updates: Partial<HealthCheckRow>): Promise<HealthCheckRow> {
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
  const { data: row, error } = await tenantFrom('health_checks')
    .update(payload)
    .eq('id', id)
    .select(HC_CHECK_SELECT)
    .single();
  if (error) throw new Error(`Health check update error: ${error.message}`);
  return row;
}

export async function listHealthChecks(): Promise<HealthCheckRow[]> {
  const { data, error } = await tenantFrom('health_checks')
    .select(HC_CHECK_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Health check list error: ${error.message}`);
  return data || [];
}

export async function getHealthCheck(id: string): Promise<HealthCheckRow> {
  const { data: row, error } = await tenantFrom('health_checks').select(HC_CHECK_SELECT).eq('id', id).single();
  if (error) throw new Error(`Health check get error: ${error.message}`);
  return row;
}

export async function deleteHealthCheck(id: string): Promise<void> {
  const { error } = await tenantFrom('health_checks').delete().eq('id', id);
  if (error) throw new Error(`Health check delete error: ${error.message}`);
}

/* ── Health Check Runs ────────────────────────────────────── */

export async function insertRun(data: Omit<HealthCheckRunRow, 'id' | 'created_at'>): Promise<HealthCheckRunRow> {
  const { data: row, error } = await tenantFrom('health_check_runs')
    .insert(tenantInsertPayload(data))
    .select()
    .single();
  if (error) throw new Error(`HC run insert error: ${error.message}`);
  return row;
}

import type { RunListOptions } from './run-list-options.ts';
export type { RunListOptions };

export async function listRuns(healthCheckId: string, options: RunListOptions = {}): Promise<HealthCheckRunRow[]> {
  const limit = options.limit || 50;
  let query = tenantFrom('health_check_runs').select('*').eq('health_check_id', healthCheckId);

  if (options.status?.length) query = query.in('status', options.status);
  if (options.from) query = query.gte('created_at', options.from);
  if (options.to) query = query.lte('created_at', options.to);

  query = query.order('created_at', { ascending: false });
  if (options.offset) query = query.range(options.offset, options.offset + limit - 1);
  else query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`HC run list error: ${error.message}`);
  return data || [];
}

export async function countRuns(
  healthCheckId: string,
  options: Pick<RunListOptions, 'status' | 'from' | 'to'> = {},
): Promise<number> {
  let query = tenantFrom('health_check_runs')
    .select('*', { count: 'exact', head: true })
    .eq('health_check_id', healthCheckId);

  if (options.status?.length) query = query.in('status', options.status);
  if (options.from) query = query.gte('created_at', options.from);
  if (options.to) query = query.lte('created_at', options.to);

  const { count, error } = await query;
  if (error) throw new Error(`HC run count error: ${error.message}`);
  return count ?? 0;
}

/* ── Daily Aggregation (RPC) ──────────────────────────────── */

export interface DailyRunSummaryRow {
  run_date: string;
  total_runs: number;
  pass_count: number;
  fail_count: number;
  timeout_count: number;
  error_count: number;
}

export async function getDailyRunSummary(
  checkId: string,
  startDate: string,
  endDate: string,
): Promise<DailyRunSummaryRow[]> {
  const { data, error } = await tenantClient().rpc('hc_daily_run_summary', {
    p_check_id: checkId,
    p_start: startDate,
    p_end: endDate,
    p_workspace_id: requireWorkspaceId(),
  });
  if (error) throw new Error(`hc_daily_run_summary RPC error: ${error.message}`);
  return (data as DailyRunSummaryRow[]) || [];
}

/* ── Failure Patterns (RPC) ───────────────────────────────── */

export interface FailurePatternsResult {
  error_groups: { error_message: string; count: number }[];
  hourly_distribution: { hour: number; count: number }[];
}

export async function getFailurePatterns(
  checkId: string,
  startDate: string,
  endDate: string,
): Promise<FailurePatternsResult> {
  const wsId = requireWorkspaceId();
  const { data, error } = await tenantClient().rpc('hc_failure_patterns', {
    p_check_id: checkId,
    p_start: startDate,
    p_end: endDate,
    p_workspace_id: wsId,
  });
  if (error) throw new Error(`hc_failure_patterns RPC error: ${error.message}`);
  return (data as FailurePatternsResult) ?? { error_groups: [], hourly_distribution: [] };
}

/* ── Incidents ────────────────────────────────────────────── */

export async function listIncidents(
  healthCheckId: string,
  options: { limit?: number } = {},
): Promise<HealthCheckIncidentRow[]> {
  const limit = options.limit || 20;
  const { data, error } = await tenantFrom('health_check_incidents')
    .select('*')
    .eq('health_check_id', healthCheckId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`HC incident list error: ${error.message}`);
  return data || [];
}

export async function getOpenIncident(healthCheckId: string): Promise<HealthCheckIncidentRow | null> {
  const { data, error } = await tenantFrom('health_check_incidents')
    .select('*')
    .eq('health_check_id', healthCheckId)
    .is('resolved_at', null)
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`HC incident get error: ${error.message}`);
  return data?.[0] || null;
}

/* ── Service-role helpers (used by the scheduler and Run Now) ── */

export async function serviceGetHealthCheck(
  id: string,
): Promise<HealthCheckRow & { health_check_profile: HealthCheckProfileRow }> {
  const sb = getServiceSupabase();
  const { data: row, error } = await sb
    .from('health_checks')
    .select(
      '*, health_check_profile:health_check_profiles(*, provider:providers(*), hc_provider_key:health_check_provider_keys(*))',
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(`HC service get error: ${error.message}`);
  return row;
}

export async function listDueChecks(): Promise<(HealthCheckRow & { health_check_profile: HealthCheckProfileRow })[]> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('health_checks')
    .select(
      '*, health_check_profile:health_check_profiles(*, provider:providers(*), hc_provider_key:health_check_provider_keys(*))',
    )
    .eq('is_active', true)
    .or('last_run_at.is.null,last_run_at.lt.' + new Date(Date.now() - 60_000).toISOString());
  if (error) throw new Error(`listDueChecks error: ${error.message}`);

  const rows = data || [];
  if (rows.length === 0) return [];

  const checkIds = rows.map((r) => r.id);
  const { data: openIncidents } = await sb
    .from('health_check_incidents')
    .select('health_check_id')
    .in('health_check_id', checkIds)
    .is('resolved_at', null);

  const incidentSet = new Set((openIncidents || []).map((i) => i.health_check_id));

  return rows.filter((row) => {
    if (!row.last_run_at) return true;
    const elapsed = Date.now() - new Date(row.last_run_at).getTime();
    const cadence = incidentSet.has(row.id) ? (row.outage_cadence_minutes ?? row.cadence_minutes) : row.cadence_minutes;
    return elapsed >= cadence * 60_000;
  });
}

export async function serviceInsertRun(data: Omit<HealthCheckRunRow, 'id' | 'created_at'>): Promise<HealthCheckRunRow> {
  const sb = getServiceSupabase();
  const { data: row, error } = await sb.from('health_check_runs').insert(data).select().single();
  if (error) throw new Error(`HC run insert (service) error: ${error.message}`);
  return row;
}

export async function serviceUpdateCheckLastRun(id: string): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb
    .from('health_checks')
    .update({ last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`HC update last_run_at error: ${error.message}`);
}

export async function serviceGetOpenIncident(healthCheckId: string): Promise<HealthCheckIncidentRow | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('health_check_incidents')
    .select('*')
    .eq('health_check_id', healthCheckId)
    .is('resolved_at', null)
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`serviceGetOpenIncident error: ${error.message}`);
  return data?.[0] || null;
}

export async function serviceOpenIncident(
  healthCheckId: string,
  workspaceId: string,
  errorMessage: string | null,
): Promise<HealthCheckIncidentRow> {
  const sb = getServiceSupabase();
  const { data: row, error } = await sb
    .from('health_check_incidents')
    .insert({
      health_check_id: healthCheckId,
      workspace_id: workspaceId,
      last_error: errorMessage,
    })
    .select()
    .single();
  if (error) throw new Error(`serviceOpenIncident error: ${error.message}`);
  return row;
}

export async function serviceUpdateIncident(
  incidentId: string,
  updates: Partial<HealthCheckIncidentRow>,
): Promise<void> {
  const sb = getServiceSupabase();
  const { error } = await sb.from('health_check_incidents').update(updates).eq('id', incidentId);
  if (error) throw new Error(`serviceUpdateIncident error: ${error.message}`);
}

export async function serviceResolveIncident(incidentId: string, startedAt: string): Promise<void> {
  const now = new Date();
  const durationSeconds = Math.round((now.getTime() - new Date(startedAt).getTime()) / 1000);
  const sb = getServiceSupabase();
  const { error } = await sb
    .from('health_check_incidents')
    .update({
      resolved_at: now.toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq('id', incidentId);
  if (error) throw new Error(`serviceResolveIncident error: ${error.message}`);
}
