/**
 * Config-as-code sync — idempotent upsert of profiles, jobs, workflows by slug.
 * Dry-run compares content (not just existence) so scheduled drift checks can
 * distinguish "already in sync" (skip) from "would write" (create/update).
 */

import { createAiProfile, updateAiProfile, getAiProfileBySlug } from '../models/ai-profiles.ts';
import { createProcessingJob, updateProcessingJob, getProcessingJobBySlug } from '../models/processing-jobs.ts';
import { createWorkflow, updateWorkflow, getWorkflowBySlug } from '../models/workflows.ts';
import { errorMessage } from '../lib/error-message.ts';
import {
  contentMatches,
  JOB_COMPARE_FIELDS,
  PROFILE_COMPARE_FIELDS,
  WORKFLOW_COMPARE_FIELDS,
} from './config-sync-compare.ts';

export interface SyncConfig {
  profiles?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  workflows?: Array<Record<string, unknown>>;
}

export interface SyncDiffEntry {
  entity: 'profile' | 'job' | 'workflow';
  slug: string;
  action: 'create' | 'update' | 'skip' | 'error';
  error?: string;
}

export interface SyncResult {
  dryRun: boolean;
  diff: SyncDiffEntry[];
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

type EntityKind = SyncDiffEntry['entity'];

interface SyncCounters {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

async function syncEntityBySlug(args: {
  entity: EntityKind;
  item: Record<string, unknown>;
  dryRun: boolean;
  compareFields: readonly string[];
  getBySlug: (slug: string) => Promise<Record<string, unknown> | null>;
  create: (item: Record<string, unknown>) => Promise<unknown>;
  update: (id: string, item: Record<string, unknown>) => Promise<unknown>;
  counters: SyncCounters;
  diff: SyncDiffEntry[];
}): Promise<void> {
  const slug = args.item.slug as string;
  if (!slug) {
    args.diff.push({ entity: args.entity, slug: '(missing)', action: 'error', error: 'slug required' });
    args.counters.errors++;
    return;
  }
  try {
    const existing = await args.getBySlug(slug);
    if (args.dryRun) {
      if (!existing) {
        args.diff.push({ entity: args.entity, slug, action: 'create' });
        args.counters.created++;
        return;
      }
      const matches = contentMatches(existing, args.item, [...args.compareFields]);
      if (matches) {
        args.diff.push({ entity: args.entity, slug, action: 'skip' });
        args.counters.skipped++;
        return;
      }
      args.diff.push({ entity: args.entity, slug, action: 'update' });
      args.counters.updated++;
      return;
    }
    if (existing) {
      await args.update(String(existing.id), args.item);
      args.diff.push({ entity: args.entity, slug, action: 'update' });
      args.counters.updated++;
    } else {
      await args.create(args.item);
      args.diff.push({ entity: args.entity, slug, action: 'create' });
      args.counters.created++;
    }
  } catch (err) {
    args.diff.push({ entity: args.entity, slug, action: 'error', error: errorMessage(err) });
    args.counters.errors++;
  }
}

export async function syncConfig(config: SyncConfig, dryRun = false): Promise<SyncResult> {
  const diff: SyncDiffEntry[] = [];
  const counters: SyncCounters = { created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const item of config.profiles || []) {
    await syncEntityBySlug({
      entity: 'profile',
      item,
      dryRun,
      compareFields: PROFILE_COMPARE_FIELDS,
      getBySlug: async (slug) => (await getAiProfileBySlug(slug)) as Record<string, unknown> | null,
      create: (row) => createAiProfile(row as never),
      update: (id, row) => updateAiProfile(id, row as never),
      counters,
      diff,
    });
  }

  for (const item of config.jobs || []) {
    await syncEntityBySlug({
      entity: 'job',
      item,
      dryRun,
      compareFields: JOB_COMPARE_FIELDS,
      getBySlug: async (slug) => (await getProcessingJobBySlug(slug)) as Record<string, unknown> | null,
      create: (row) => createProcessingJob(row as never),
      /* Repo is source of truth: replace config so absent nested keys are deleted */
      update: (id, row) => updateProcessingJob(id, row as never, { replaceConfig: true }),
      counters,
      diff,
    });
  }

  for (const item of config.workflows || []) {
    await syncEntityBySlug({
      entity: 'workflow',
      item,
      dryRun,
      compareFields: WORKFLOW_COMPARE_FIELDS,
      getBySlug: async (slug) => (await getWorkflowBySlug(slug)) as Record<string, unknown> | null,
      create: (row) => createWorkflow(row as never),
      update: (id, row) => updateWorkflow(id, row as never),
      counters,
      diff,
    });
  }

  return { dryRun, diff, ...counters };
}
