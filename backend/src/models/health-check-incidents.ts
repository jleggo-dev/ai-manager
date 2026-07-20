/**
 * Model – Health Check Incidents
 * -------------------------------
 * Tenant CRUD + service-role helpers for health_check_incidents.
 */

import { tenantFrom } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import type { HealthCheckIncidentRow } from '../types.ts';

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
