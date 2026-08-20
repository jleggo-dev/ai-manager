/**
 * Give the vision jobs a failover model.
 *
 * All four photo-reading jobs — parse-meal, identify-food, parse-fridge-photo,
 * parse-nutrition-label — ran `gemini-3.1-pro` with `failover_external_ai_id: null`. On 2026-08-20
 * the owner's two photo logs came back empty and were stored as confirmed 0-kcal meals; the cause,
 * reproduced against the live API with his own photo, was
 * `MODEL_REQUEST_RATE_LIMIT_EXCEEDED — "Resource has been exhausted"`. Not one model having a bad
 * moment: gemini-3.1-pro, gemini-3.5-flash AND gemini-3.1-flash-lite were all exhausted, so every
 * gemini-backed job on the account was degraded at once. With no failover there was nowhere to go.
 *
 * `gpt-5-mini` is the pick, measured on that same photo rather than assumed:
 *   kimi-2.6-azure  — CANNOT see images ("I'm unable to view images"), 3,428 tokens to say so
 *   gpt-4o-mini     — vaguer read, and 27,760 input tokens: 8.7x gpt-5-mini for one image
 *   gpt-5-nano      — accurate but emits markdown, which fights a strict-JSON job
 *   gpt-5-mini      — "A berry yogurt (parfait) bowl ... and a cup of coffee", 3,188 in, 8.0s ✓
 *
 * Run: node --import tsx apps/cadence-api/scripts/set-vision-failover.ts [--model gpt-5-mini] [--dry]
 */
import { withAim } from '../src/ai/aim.ts';
import { getProcessingJobBySlug } from '@ai-admin/core';
import { getAiProfile, updateAiProfile } from '@ai-admin/core';

const VISION_JOBS = ['parse-meal', 'identify-food', 'parse-fridge-photo', 'parse-nutrition-label'];
const ACTOR = 'platform:cadence';

async function main() {
  const argv = process.argv.slice(2);
  const model = argv.includes('--model') ? (argv[argv.indexOf('--model') + 1] as string) : 'gpt-5-mini';
  const dry = argv.includes('--dry');

  await withAim(ACTOR, async () => {
    const seen = new Set<string>();
    for (const slug of VISION_JOBS) {
      const job = await getProcessingJobBySlug(slug);
      if (!job?.ai_profile_id) {
        console.log(`- ${slug}: no job or no profile`);
        continue;
      }
      if (seen.has(job.ai_profile_id)) {
        console.log(`- ${slug}: shares an already-updated profile`);
        continue;
      }
      seen.add(job.ai_profile_id);

      const profile = (await getAiProfile(job.ai_profile_id)) as {
        id: string;
        name: string;
        provider_id: string;
        external_ai_id: string;
        failover_external_ai_id: string | null;
      };
      console.log(
        `- ${slug}: profile "${profile.name}" primary=${profile.external_ai_id} failover=${profile.failover_external_ai_id ?? 'NONE'}`,
      );
      if (dry) continue;

      // Same provider — the failover is a different MODEL on Devs.ai, not a different vendor.
      await updateAiProfile(profile.id, {
        failover_external_ai_id: model,
        failover_provider_id: profile.provider_id,
      } as unknown as Parameters<typeof updateAiProfile>[1]);
      console.log(`  → failover set to ${model}`);
    }
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
