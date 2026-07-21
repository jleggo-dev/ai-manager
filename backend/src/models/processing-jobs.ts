/**
 * Model – Processing Jobs
 * ------------------------
 * CRUD operations for the `processing_jobs` table.
 * Processing Jobs link a job type (e.g. "Company Profiling") to an AI Profile.
 */

import type { ProcessingJobRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';

const TABLE = 'processing_jobs';

/** Create a new processing job. */
export async function createProcessingJob(data: Partial<ProcessingJobRow>): Promise<ProcessingJobRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .insert(tenantInsertPayload({ ...data, updated_at: new Date().toISOString() }))
    .select()
    .single();
  if (error) throw new Error(`Processing Job insert error: ${error.message}`);
  return row;
}

export interface UpdateProcessingJobOptions {
  /**
   * When true, write `updates.config` as-is (repo / sync source of truth).
   * Default false: deep-merge so partial UI patches keep sibling config keys.
   */
  replaceConfig?: boolean;
}

/**
 * Update an existing processing job.
 * When `config` is included in updates, it is DEEP-MERGED with the
 * existing config to avoid accidentally wiping out other config fields —
 * unless `options.replaceConfig` is set (config-as-code sync).
 */
export async function updateProcessingJob(
  id: string,
  updates: Partial<ProcessingJobRow>,
  options?: UpdateProcessingJobOptions,
): Promise<ProcessingJobRow> {
  /* Partial UI patches deep-merge; sync passes replaceConfig so removals stick */
  if (updates.config && typeof updates.config === 'object' && !options?.replaceConfig) {
    const { data: existing, error: fetchErr } = await tenantFrom(TABLE).select('config').eq('id', id).single();
    if (fetchErr) throw new Error(`Processing Job fetch for merge error: ${fetchErr.message}`);

    updates.config = deepMerge(existing?.config || {}, updates.config);
  }

  const { data: row, error } = await tenantFrom(TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Processing Job update error: ${error.message}`);
  return row;
}

/**
 * Deep merge two objects. Arrays and primitives in `source` overwrite `target`.
 * Nested objects are recursively merged.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/** List processing jobs with cursor-based pagination. Includes AI profile + provider info via join. */
export async function listProcessingJobs(
  options: { cursor?: string; limit?: number } = {},
): Promise<ProcessingJobRow[]> {
  const limit = options.limit || 50;
  let query = tenantFrom(TABLE)
    .select(
      '*, ai_profile:ai_profiles(id, name, external_ai_id, mode, provider:providers!ai_profiles_provider_id_fkey(id, name, type))',
    )
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (options.cursor) {
    query = query.lt('created_at', options.cursor);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Processing Job list error: ${error.message}`);
  return data || [];
}

/** Get a single processing job by id. */
export async function getProcessingJob(id: string): Promise<ProcessingJobRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .select(
      '*, ai_profile:ai_profiles(*, provider:providers!ai_profiles_provider_id_fkey(*), failover_provider:providers!ai_profiles_failover_provider_id_fkey(id, name, type, base_url, api_key, request_timeout_ms))',
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(`Processing Job get error: ${error.message}`);
  return row;
}

/** Get a processing job by slug (e.g. "company-profiling"). */
export async function getProcessingJobBySlug(slug: string): Promise<ProcessingJobRow | null> {
  const { data: row, error } = await tenantFrom(TABLE)
    .select(
      '*, ai_profile:ai_profiles(*, provider:providers!ai_profiles_provider_id_fkey(*), failover_provider:providers!ai_profiles_failover_provider_id_fkey(id, name, type, base_url, api_key, request_timeout_ms))',
    )
    .eq('slug', slug)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Processing Job slug lookup error: ${error.message}`);
  }
  return row;
}

/** Delete a processing job by id. */
export async function deleteProcessingJob(id: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('id', id);
  if (error) throw new Error(`Processing Job delete error: ${error.message}`);
}
