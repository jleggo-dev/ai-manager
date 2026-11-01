/**
 * Point one AI Admin profile at a different primary and/or failover model, by slug.
 *
 *   npx tsx scripts/repoint-profile.ts --slug cadence-coach --primary claude-sonnet-5-5 --failover gpt-5.2 [--dry]
 *   npx tsx scripts/repoint-profile.ts --id <profile-uuid> …     (a profile with no slug, e.g. the capture Broker)
 *   npx tsx scripts/repoint-profile.ts --slug cadence-coach --primary <model> --verify [--floor 80] [--force "<reason>"]
 *
 * Why this exists (2026-10-28): Devs.ai kept `claude-sonnet-5`, `anthropic-claude-4-5-sonnet`,
 * `claude-opus-5` and `gemini-3.5-flash` in its model CATALOG but stopped serving them to this
 * account — every call answered 400 "Model … is not available for this request". The catalog
 * refresh in AI Admin therefore showed nothing deprecated while prescribe_session failed 414 times
 * in a day and every session on the phone opened to "Couldn't open this just now". The check
 * that matters is a live call, not the listing: before repointing, prove the model answers
 * (the probe in this incident's notes, or AI Admin's test chat).
 *
 * `--verify` is that lesson in code for the coach (HARNESS-V3 C5.3): prove the model with a live
 * call, and prove it with her tools. It runs `eval:tools:smoke` on the new primary and, on a miss,
 * puts the old pointers back. Details and limits in `repoint-verify.ts`; the short version:
 *   - The pointer is written FIRST and is live for every coach turn, real users included, while
 *     the smoke runs (~10 minutes). Testing it before the write needs a per-session model override
 *     that AI Admin's chat engine does not have; that would be an engine change, not built here.
 *   - A miss (F1 under the floor, no tool call seen, a different model answered, or the run died)
 *     writes back the pointers read before the write, exactly, and exits non-zero.
 *   - `--force "<reason>"` keeps the new pointer through a miss. The reason is printed and logged.
 *   - Every verified repoint, kept or reverted, appends one line to
 *     config/ai-admin/repoint-log.jsonl; commit it with the config change.
 *   - The floor defaults from `eval-tool-selection.baseline.json`; `--floor` overrides it.
 *   - It only proves a PRIMARY of the coach's own profile; anything else is refused before writing.
 * Whether a miss should block the repoint or only be reported is owner ruling R5 (open). This
 * builds the gate as the design proposes, with --force as the way through.
 *
 * Writes only the model pointers on the one profile named; prompts, runtime options and every
 * other profile are untouched. `provision-aim.ts` would re-sync profiles from config and can
 * clobber live pointers — this is the narrow tool. Record the new pointers in
 * config/ai-admin/ai-admin.config.json in the same change so the file stays the truth.
 */
import { withAim } from '../src/ai/aim.ts';
import { cadenceConfig } from '../src/config.ts';
import { getAiProfile, getAiProfileBySlug, getProcessingJobBySlug, updateAiProfile } from '@ai-admin/core';
import { missingEnv } from './eval-tool-selection-world.ts';
import { parseFloor, readBaseline, smokeFloor } from './eval-tool-selection-smoke.ts';
import { appendVerifyLog, decide, preflight, runSmoke } from './repoint-verify.ts';

const ACTOR = 'platform:cadence';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

interface Profile {
  id: string;
  name: string;
  provider_id: string;
  external_ai_id: string;
  failover_provider_id: string | null;
  failover_external_ai_id: string | null;
}
type Pointers = Record<string, string | null>;
type ProfileUpdate = Parameters<typeof updateAiProfile>[1];

/** `--force` with nothing after it (or another flag after it) is a force with no reason. */
function forceArg(): string | undefined {
  if (!has('force')) return undefined;
  const raw = arg('force');
  return raw && !raw.startsWith('--') ? raw : '';
}

function floorArg(): { floor: number; from: string } | null {
  const raw = arg('floor');
  if (raw !== null) {
    const parsed = parseFloor(raw);
    if ('error' in parsed) throw new Error(parsed.error);
    return { floor: parsed.floor, from: 'given with --floor' };
  }
  return smokeFloor(readBaseline());
}

/** Refuse before writing anything when --verify cannot mean what it says. */
async function verifyPlan(profile: Profile, primary: string | null, force: string | undefined) {
  const job = (await getProcessingJobBySlug(cadenceConfig.aim.coachJobSlug)) as { ai_profile_id?: string } | null;
  const floor = floorArg();
  const pre = preflight({
    primary,
    isCoachProfile: !!job?.ai_profile_id && job.ai_profile_id === profile.id,
    floor: floor?.floor ?? null,
    force,
    evalEnvProblem: missingEnv(),
  });
  if (!pre.ok) throw new Error(`--verify refused, nothing written: ${pre.why}`);
  console.log(
    `  --verify: the smoke eval runs on ${primary} after the write; floor F1 ${floor!.floor} (${floor!.from})`,
  );
  return floor!;
}

/** Run the smoke on the live pointer; keep it, keep it by force, or write `before` back. */
async function verifyLive(opts: {
  profile: Profile;
  primary: string;
  before: Pointers;
  updates: Pointers;
  floor: number;
  force: string | undefined;
}): Promise<boolean> {
  const { profile, primary, before, updates, floor, force } = opts;
  const restore = () => withAim(ACTOR, () => updateAiProfile(profile.id, before as unknown as ProfileUpdate));
  console.log(`\n⚠ LIVE: "${profile.name}" now answers EVERY coach turn on ${primary}, real users included,`);
  console.log('  until the smoke run below finishes (~10 minutes).');
  console.log(`  If this process dies, the old pointers were: ${JSON.stringify(before)}`);
  console.log(
    `  Put them back with: npx tsx scripts/repoint-profile.ts --id ${profile.id} --primary ${before.external_ai_id ?? profile.external_ai_id}\n`,
  );

  const onSigint = () => {
    console.log('\nstopped — putting the old pointers back');
    restore()
      .then(() => console.log(`  restored: ${JSON.stringify(before)}`))
      .catch((e) => console.error('  RESTORE FAILED — put them back by hand:', e))
      .finally(() => process.exit(130));
  };
  process.once('SIGINT', onSigint);
  const result = await runSmoke(floor);
  process.off('SIGINT', onSigint);

  const verdict = decide({ result, floor, force, expectedModel: primary });
  if (verdict.action === 'revert') await restore();
  const logged = appendVerifyLog({
    at: new Date().toISOString(),
    profile: profile.name,
    before,
    after: verdict.action === 'revert' ? before : updates,
    floor,
    f1: result?.f1 ?? null,
    models: result?.models ?? [],
    action: verdict.action,
    why: verdict.why,
    force: force ?? null,
  });

  console.log('\n══ VERIFY ══');
  if (verdict.action === 'keep') console.log(`  ✓ kept ${primary}: ${verdict.why}`);
  if (verdict.action === 'keep-forced') console.log(`  ⚠ kept ${primary} BY FORCE: ${verdict.why}`);
  if (verdict.action === 'revert') {
    console.log(`  ✗ reverted to ${JSON.stringify(before)}: ${verdict.why}`);
    console.log('    The new pointer was live while the smoke ran; it is not live now.');
  }
  if (logged) console.log(`  logged to ${logged} — commit it with the config change`);
  return verdict.action !== 'revert';
}

async function main() {
  const slug = arg('slug');
  const id = arg('id');
  const primary = arg('primary');
  const failover = arg('failover');
  const dry = has('dry');
  const verify = has('verify');
  const force = forceArg();
  if ((!slug && !id) || (!primary && !failover)) {
    throw new Error(
      'usage: (--slug <profile-slug> | --id <uuid>) [--primary <model>] [--failover <model>] [--dry] ' +
        '[--verify [--floor <F1>] [--force "<reason>"]]',
    );
  }
  if (force !== undefined && !verify) throw new Error('--force only means something with --verify');
  const read = () => (id ? getAiProfile(id) : getAiProfileBySlug(slug!));
  let kept = true;
  await withAim(ACTOR, async () => {
    const profile = (await read()) as Profile | null;
    if (!profile) throw new Error(`no profile for ${id ? `id "${id}"` : `slug "${slug}"`}`);
    console.log(
      `${profile.name}: primary=${profile.external_ai_id} failover=${profile.failover_external_ai_id ?? 'NONE'}`,
    );
    const updates: Pointers = {};
    if (primary) updates.external_ai_id = primary;
    if (failover) {
      updates.failover_external_ai_id = failover;
      updates.failover_provider_id = profile.failover_provider_id ?? profile.provider_id;
    }
    // Read before the write, so a revert puts back exactly what was there.
    const before: Pointers = Object.fromEntries(
      Object.keys(updates).map((k) => [k, (profile as unknown as Pointers)[k] ?? null]),
    );
    console.log(`  → ${JSON.stringify(updates)}${dry ? '  (dry run, nothing written)' : ''}`);
    const floor = verify ? await verifyPlan(profile, primary, force) : null;
    if (dry) return;
    await updateAiProfile(profile.id, updates as unknown as ProfileUpdate);
    const after = (await read()) as Profile | null;
    console.log(`  now: primary=${after?.external_ai_id} failover=${after?.failover_external_ai_id ?? 'NONE'}`);
    if (floor) kept = await verifyLive({ profile, primary: primary!, before, updates, floor: floor.floor, force });
  });
  if (!kept) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    // A refusal is a sentence, not a crash: print the sentence. DEBUG=1 shows the stack.
    console.error(process.env.DEBUG ? e : String((e as Error)?.message ?? e));
    process.exit(1);
  });
