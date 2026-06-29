/**
 * Model – Triggers
 * ----------------
 * External-clock and event-driven execution targets (jobs/workflows).
 */

import type { TriggerRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';

const TABLE = 'triggers';

export async function getTriggerBySlug(slug: string): Promise<TriggerRow | null> {
  const { data, error } = await tenantFrom(TABLE).select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`Trigger lookup error: ${error.message}`);
  return data;
}

export async function listTriggers(): Promise<TriggerRow[]> {
  const { data, error } = await tenantFrom(TABLE).select('*').order('slug').limit(500);
  if (error) throw new Error(`Trigger list error: ${error.message}`);
  return data || [];
}

export async function createTrigger(data: Partial<TriggerRow>): Promise<TriggerRow> {
  const { data: row, error } = await tenantFrom(TABLE).insert(tenantInsertPayload(data)).select().single();
  if (error) throw new Error(`Trigger insert error: ${error.message}`);
  return row;
}

export async function updateTrigger(id: string, updates: Partial<TriggerRow>): Promise<TriggerRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Trigger update error: ${error.message}`);
  return row;
}

export async function deleteTrigger(id: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('id', id);
  if (error) throw new Error(`Trigger delete error: ${error.message}`);
}
