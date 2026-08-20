/**
 * Provision the Coach chat job + its persona in AI Admin.
 *
 * The Coach is a chat session BOUND TO A PROCESSING JOB ("cadence-coach-chat"). The
 * persona is that job's `config.systemPrompt` — a first-class, build-rules-editable
 * field (see backend/src/schemas/processing-jobs.ts). Binding the job also turns on
 * conversation diagnostics/analytics (they key off processing_job_id). This script
 * upserts the job (by slug) and sets its system prompt from the version-controlled
 * seed (config/ai-admin/cadence-coach.system-prompt.md). Re-run after editing the seed.
 *
 * It also writes `config.summarizer`, the compaction policy the engine reads at session open.
 *
 * ⚠️ Both only reach sessions opened AFTER this runs — a live thread keeps the snapshot it was
 * born with (PLAN.md, "A persona edit reaches nobody who is already talking to her"). Verify
 * against a NEW conversation.
 *
 * Run: node --import tsx apps/cadence-api/scripts/set-coach-persona.ts
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProcessingJob,
  updateProcessingJob,
  getProcessingJobBySlug,
  getAiProfile,
  updateAiProfile,
} from '@ai-admin/core';
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SEED = path.join(repoRoot, 'config/ai-admin/cadence-coach.system-prompt.md');
const ACTOR = cadenceConfig.devUserId ?? '00000000-0000-4000-a000-000000000001';
const SLUG = cadenceConfig.aim.coachJobSlug;

/**
 * How long a conversation may grow before the older half becomes a summary.
 *
 * Policy lives HERE, beside the persona, because it is a coaching decision; the mechanism lives in
 * the engine (`backend/src/services/session-compaction.ts`), which owns the transcript and the
 * request, and therefore survives a change of provider. Threading (#250) moved the transcript to
 * the provider and the bill still grew ~594/turn with nothing bounding it (measured 2026-08-20,
 * probe-thread-turns.ts) — so the bound is ours to own, and this is it.
 *
 * CALIBRATED FOR QUALITY, NOT COST (owner, 2026-08-20: "quality is more important than cost —
 * 100K per message isn't indicative of quality though"). Both halves of that sentence are the
 * spec: a huge context is ANTI-quality — the measured tool-calling refusal happened at ~119k —
 * and an over-eager summary that eats live conversation is too. So the working set stays
 * generous and bounded:
 *
 *  - `triggerTokens` is in `estimateSessionTokens` units — char/4 over the stored history — and
 *    real billed tokens run ~1.78× that (solved against production billing, 2026-08-19). 20k
 *    units ≈ first compaction near ~36k billed. After compacting, context falls to persona +
 *    summary + the kept turns (~15k billed) and sawtooths in a ~15–40k band: far below the
 *    degradation zone, far above ever compacting a short chat. The old 32k was set before the
 *    units were calibrated and fired near ~60k billed — later than intended.
 *  - `keepLastNTurns` counts MESSAGES: 20 is ten exchanges verbatim behind the summary, because
 *    recency is where conversational quality lives; the summary only ever replaces the far past.
 *
 * Both are build-rules-editable without a deploy — but note the engine copies this onto the
 * SESSION at open (`chat-session-open.ts`), so an edit reaches new sessions only.
 */
const SUMMARIZER = { jobSlug: 'coach-compact', triggerTokens: 20_000, keepLastNTurns: 20 } as const;

async function main() {
  const profileId = cadenceConfig.aim.coachProfileId;
  if (!profileId) throw new Error('AIM_COACH_PROFILE_ID is not set — provision the coach profile first.');

  const systemPrompt = (await readFile(SEED, 'utf8')).trim();
  if (!systemPrompt) throw new Error(`Seed file is empty: ${SEED}`);

  await withAim(ACTOR, async () => {
    const existing = await getProcessingJobBySlug(SLUG);
    // Free-form chat job: no promptTemplate (the user's message is the turn); the
    // persona rides in config.systemPrompt; diagnostics default on.
    const config = { ...((existing?.config as Record<string, unknown>) ?? {}), systemPrompt, summarizer: SUMMARIZER };
    if (existing) {
      await updateProcessingJob(existing.id, { config, ai_profile_id: profileId });
      console.log(`✓ updated job "${SLUG}" (${existing.id}) — persona ${systemPrompt.length} chars.`);
    } else {
      const created = await createProcessingJob({
        slug: SLUG,
        name: 'Cadence Coach (chat)',
        description: 'Streaming coaching conversation. Persona in config.systemPrompt; app appends the per-user dossier.',
        ai_profile_id: profileId,
        config,
        is_active: true,
      });
      console.log(`✓ created job "${SLUG}" (${created.id}) — persona ${systemPrompt.length} chars.`);
    }

    // One-time cleanup: the persona briefly lived on the profile's config; the job owns it now.
    const profile = (await getAiProfile(profileId)) as { config?: Record<string, unknown> | null };
    if (profile.config && 'systemPrompt' in profile.config) {
      const { systemPrompt: _drop, ...rest } = profile.config;
      void _drop;
      await updateAiProfile(profileId, { config: rest } as unknown as Parameters<typeof updateAiProfile>[1]);
      console.log('  (cleared vestigial profile.config.systemPrompt)');
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
