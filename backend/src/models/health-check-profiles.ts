/**
 * Model – Health Check Profiles
 * ------------------------------
 * CRUD for health_check_profiles (AI profile + key bindings for checks).
 */

import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';
import type { HealthCheckProfileRow } from '../types.ts';

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
