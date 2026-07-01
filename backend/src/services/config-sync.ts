/**
 * Config-as-code sync — idempotent upsert of profiles, jobs, workflows by slug.
 */

import {
  createAiProfile,
  updateAiProfile,
  getAiProfileBySlug,
} from "../models/ai-profiles.ts";
import {
  createProcessingJob,
  updateProcessingJob,
  getProcessingJobBySlug,
} from "../models/processing-jobs.ts";
import {
  createWorkflow,
  updateWorkflow,
  getWorkflowBySlug,
} from "../models/workflows.ts";
import { errorMessage } from "../lib/error-message.ts";

export interface SyncConfig {
  profiles?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  workflows?: Array<Record<string, unknown>>;
}

export interface SyncDiffEntry {
  entity: "profile" | "job" | "workflow";
  slug: string;
  action: "create" | "update" | "skip" | "error";
  error?: string;
}

export interface SyncResult {
  dryRun: boolean;
  diff: SyncDiffEntry[];
  created: number;
  updated: number;
  errors: number;
}

export async function syncConfig(
  config: SyncConfig,
  dryRun = false,
): Promise<SyncResult> {
  const diff: SyncDiffEntry[] = [];
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const item of config.profiles || []) {
    const slug = item.slug as string;
    if (!slug) {
      diff.push({
        entity: "profile",
        slug: "(missing)",
        action: "error",
        error: "slug required",
      });
      errors++;
      continue;
    }
    try {
      const existing = await getAiProfileBySlug(slug);
      if (dryRun) {
        diff.push({
          entity: "profile",
          slug,
          action: existing ? "update" : "create",
        });
        if (existing) updated++;
        else created++;
        continue;
      }
      if (existing) {
        await updateAiProfile(existing.id, item as never);
        diff.push({ entity: "profile", slug, action: "update" });
        updated++;
      } else {
        await createAiProfile(item as never);
        diff.push({ entity: "profile", slug, action: "create" });
        created++;
      }
    } catch (err) {
      diff.push({
        entity: "profile",
        slug,
        action: "error",
        error: errorMessage(err),
      });
      errors++;
    }
  }

  for (const item of config.jobs || []) {
    const slug = item.slug as string;
    if (!slug) {
      diff.push({
        entity: "job",
        slug: "(missing)",
        action: "error",
        error: "slug required",
      });
      errors++;
      continue;
    }
    try {
      const existing = await getProcessingJobBySlug(slug);
      if (dryRun) {
        diff.push({
          entity: "job",
          slug,
          action: existing ? "update" : "create",
        });
        if (existing) updated++;
        else created++;
        continue;
      }
      if (existing) {
        await updateProcessingJob(existing.id, item as never);
        diff.push({ entity: "job", slug, action: "update" });
        updated++;
      } else {
        await createProcessingJob(item as never);
        diff.push({ entity: "job", slug, action: "create" });
        created++;
      }
    } catch (err) {
      diff.push({
        entity: "job",
        slug,
        action: "error",
        error: errorMessage(err),
      });
      errors++;
    }
  }

  for (const item of config.workflows || []) {
    const slug = item.slug as string;
    if (!slug) {
      diff.push({
        entity: "workflow",
        slug: "(missing)",
        action: "error",
        error: "slug required",
      });
      errors++;
      continue;
    }
    try {
      const existing = await getWorkflowBySlug(slug);
      if (dryRun) {
        diff.push({
          entity: "workflow",
          slug,
          action: existing ? "update" : "create",
        });
        if (existing) updated++;
        else created++;
        continue;
      }
      if (existing) {
        await updateWorkflow(existing.id, item as never);
        diff.push({ entity: "workflow", slug, action: "update" });
        updated++;
      } else {
        await createWorkflow(item as never);
        diff.push({ entity: "workflow", slug, action: "create" });
        created++;
      }
    } catch (err) {
      diff.push({
        entity: "workflow",
        slug,
        action: "error",
        error: errorMessage(err),
      });
      errors++;
    }
  }

  return { dryRun, diff, created, updated, errors };
}
