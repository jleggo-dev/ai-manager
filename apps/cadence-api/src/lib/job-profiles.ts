/**
 * Resolve each job's `ai_profile_id` before syncing it to AI Admin — shared by
 * scripts/sync-jobs.ts and scripts/provision-aim.ts (they previously kept two copies of this
 * "in lockstep", which is exactly how they drifted).
 *
 * Two rules:
 *  1. A PLACEHOLDER token (`<CADENCE_COACH_PROFILE_UUID>`) resolves to that tier's live profile.
 *     The TOKEN is authoritative — it names the tier right there in the config, so what you read
 *     in ai-admin.config.json is what gets synced. (The old code matched on a hardcoded slug set
 *     instead, which silently disagreed with the config: `nutrition-baseline` declared COACH but
 *     was missing from the set, so it synced to the cheap Broker model.)
 *  2. An EXPLICIT UUID is left alone — that's a deliberately pinned live profile (e.g. parse-meal
 *     → the Gemini vision profile). Sync must never steal it back.
 */

export interface ProfileIds {
  coachId: string;
  brokerId: string;
  /** Absent until scripts/provision-research-profile.ts has run — only jobs that USE the token need it. */
  researchId?: string | null;
}

/** `<ANYTHING_IN_ANGLE_BRACKETS>` — the config's un-resolved placeholder form. */
export function isProfilePlaceholder(value: unknown): value is string {
  return typeof value === 'string' && /^<[^>]+>$/.test(value);
}

/** Map a placeholder token to a live profile id. Unknown tokens throw — a typo must fail the
 *  sync loudly rather than quietly routing a job to the wrong (cheaper) model. */
export function resolveProfileToken(token: string, ids: ProfileIds): string {
  if (token.includes('COACH')) return ids.coachId;
  if (token.includes('BROKER')) return ids.brokerId;
  if (token.includes('RESEARCH')) {
    if (!ids.researchId) {
      throw new Error(
        `${token} used but no cadence-research profile exists — run scripts/provision-research-profile.ts first`,
      );
    }
    return ids.researchId;
  }
  throw new Error(`Unknown ai_profile_id placeholder ${token} — expected COACH, BROKER or RESEARCH profile tokens`);
}

/** Resolve placeholders in place; pinned (explicit-UUID) jobs are returned untouched. */
export function resolveJobProfileIds(jobs: Array<{ slug: string; ai_profile_id?: unknown }>, ids: ProfileIds): void {
  for (const job of jobs) {
    if (!isProfilePlaceholder(job.ai_profile_id)) continue; // pinned live profile — leave it
    job.ai_profile_id = resolveProfileToken(job.ai_profile_id, ids);
  }
}
