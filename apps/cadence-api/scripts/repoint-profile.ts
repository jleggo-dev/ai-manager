/**
 * Point one AI Admin profile at a different primary and/or failover model, by slug.
 *
 *   npx tsx scripts/repoint-profile.ts --slug cadence-coach --primary claude-sonnet-5-5 --failover gpt-5.2 [--dry]
 *   npx tsx scripts/repoint-profile.ts --id <profile-uuid> …     (a profile with no slug, e.g. the capture Broker)
 *
 * Why this exists (2026-10-28): Devs.ai kept `claude-sonnet-5`, `anthropic-claude-4-5-sonnet`,
 * `claude-opus-5` and `gemini-3.5-flash` in its model CATALOG but stopped serving them to this
 * account — every call answered 400 "Model … is not available for this request". The catalog
 * refresh in AI Admin therefore showed nothing deprecated while prescribe_session failed 414 times
 * in a day and every session on the phone opened to "Couldn't open this just now". The check
 * that matters is a live call, not the listing: before repointing, prove the model answers
 * (the probe in this incident's notes, or AI Admin's test chat).
 *
 * Writes only the model pointers on the one profile named; prompts, runtime options and every
 * other profile are untouched. `provision-aim.ts` would re-sync profiles from config and can
 * clobber live pointers — this is the narrow tool. Record the new pointers in
 * config/ai-admin/ai-admin.config.json in the same change so the file stays the truth.
 */
import { withAim } from '../src/ai/aim.ts';
import { getAiProfile, getAiProfileBySlug, updateAiProfile } from '@ai-admin/core';

const ACTOR = 'platform:cadence';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const slug = arg('slug');
  const id = arg('id');
  const primary = arg('primary');
  const failover = arg('failover');
  const dry = process.argv.includes('--dry');
  if ((!slug && !id) || (!primary && !failover)) {
    throw new Error('usage: (--slug <profile-slug> | --id <uuid>) [--primary <model>] [--failover <model>] [--dry]');
  }
  const read = () => (id ? getAiProfile(id) : getAiProfileBySlug(slug!));
  await withAim(ACTOR, async () => {
    const profile = (await read()) as {
      id: string;
      name: string;
      provider_id: string;
      external_ai_id: string;
      failover_provider_id: string | null;
      failover_external_ai_id: string | null;
    } | null;
    if (!profile) throw new Error(`no profile for ${id ? `id "${id}"` : `slug "${slug}"`}`);
    console.log(
      `${profile.name}: primary=${profile.external_ai_id} failover=${profile.failover_external_ai_id ?? 'NONE'}`,
    );
    const updates: Record<string, string> = {};
    if (primary) updates.external_ai_id = primary;
    if (failover) {
      updates.failover_external_ai_id = failover;
      updates.failover_provider_id = profile.failover_provider_id ?? profile.provider_id;
    }
    console.log(`  → ${JSON.stringify(updates)}${dry ? '  (dry run, nothing written)' : ''}`);
    if (dry) return;
    await updateAiProfile(profile.id, updates as unknown as Parameters<typeof updateAiProfile>[1]);
    const after = (await read()) as typeof profile;
    console.log(`  now: primary=${after?.external_ai_id} failover=${after?.failover_external_ai_id ?? 'NONE'}`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
