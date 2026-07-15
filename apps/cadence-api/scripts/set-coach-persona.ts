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

async function main() {
  const profileId = cadenceConfig.aim.coachProfileId;
  if (!profileId) throw new Error('AIM_COACH_PROFILE_ID is not set — provision the coach profile first.');

  const systemPrompt = (await readFile(SEED, 'utf8')).trim();
  if (!systemPrompt) throw new Error(`Seed file is empty: ${SEED}`);

  await withAim(ACTOR, async () => {
    const existing = await getProcessingJobBySlug(SLUG);
    // Free-form chat job: no promptTemplate (the user's message is the turn); the
    // persona rides in config.systemPrompt; diagnostics default on.
    const config = { ...((existing?.config as Record<string, unknown>) ?? {}), systemPrompt };
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
