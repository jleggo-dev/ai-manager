/**
 * Model – Health Checks + Runs
 * -----------------------------
 * CRUD for health_checks / health_check_runs, aggregation RPCs, and
 * service-role helpers used by the scheduler and Run Now.
 *
 * Provider keys, profiles, and incidents live in sibling modules;
 * this file re-exports them so existing `models/health-checks.ts`
 * import sites stay stable.
 */

import { tenantFrom, tenantInsertPayload, tenantClient, requireWorkspaceId } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import type { HealthCheckRow, HealthCheckRunRow, HealthCheckProfileRow } from '../types.ts';
import type { RunListOptions } from './run-list-options.ts';

export type { RunListOptions };

export {
  createProviderKey,
  updateProviderKey,
  listProviderKeys,
  getProviderKey,
  deleteProviderKey,
} from './health-check-provider-keys.ts';

export {
  createHcProfile,
  updateHcProfile,
  listHcProfiles,
  getHcProfile,
  deleteHcProfile,
} from './health-check-profiles.ts';

export {
  listIncidents,
  getOpenIncident,
  serviceGetOpenIncident,
  serviceOpenIncident,
  serviceUpdateIncident,
  serviceResolveIncident,
} from './health-check-incidents.ts';

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

export async function insertRun(data: Omit<HealthCheckRunRow, 'id' | 'created_at'>): Promise<HealthCheckRunRow> {
  const { data: row, error } = await tenantFrom('health_check_runs')
    .insert(tenantInsertPayload(data))
    .select()
    .single();
  if (error) throw new Error(`HC run insert error: ${error.message}`);
  return row;
}

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
