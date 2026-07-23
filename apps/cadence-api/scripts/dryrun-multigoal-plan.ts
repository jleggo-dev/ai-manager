/**
 * READ-ONLY dry run comparing the two plan-synthesis paths on a real user's goals: the SINGLE
 * synthesize_plan call vs. the FAN-OUT → reduce path. Prints each proposal + a per-goal COVERAGE
 * check + latency, so "one call vs. fan-out" is answered with evidence. Writes NOTHING to the DB
 * (both return a proposal; only commitActivities — not called here — persists).
 *
 * NOTE: the fan-out reduce's draft-priming only takes effect once the synthesize-plan prompt change
 * is live (`npm run sync-jobs`). Before that, the deployed prompt ignores <draft_activities> and the
 * reduce ≈ the single call. Run AFTER a sync to see the real fan-out coverage.
 *
 * Run: node --import tsx apps/cadence-api/scripts/dryrun-multigoal-plan.ts [userId]
 */
import type { Goal } from '@cadence/shared';
import { listGoalsByStatus } from '../src/repos/goals.ts';
import { listEquipment } from '../src/repos/equipment.ts';
import { getUser } from '../src/repos/users.ts';
import { synthesizeAndVet, type SynthesizeOpts, type SynthesizeResult } from '../src/services/plan-synthesis.ts';
import { synthesizeFanoutAndVet } from '../src/services/plan-fanout.ts';
import { sql } from '../src/db/sql.ts';

const USER = process.argv[2] ?? 'b33b0b6e-2f22-4211-a635-96188c31af7f';

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Run one synthesis path, print its proposal + per-goal coverage, and return covered/total. */
async function runPath(
  label: string,
  goals: Goal[],
  fn: () => Promise<SynthesizeResult>,
): Promise<{ covered: number; total: number; seconds: number }> {
  console.log(`\n════════ ${label} ════════`);
  const t0 = Date.now();
  const res = await fn();
  const seconds = (Date.now() - t0) / 1000;
  console.log(`  (${seconds.toFixed(1)}s)  status=${res.status}`);
  if (res.status === 'vetoed') {
    console.log('  VETOED:', res.violations?.join('; '));
    return { covered: 0, total: goals.length, seconds };
  }

  const acts = res.activities ?? [];
  console.log(`  ${acts.length} activities — note: ${res.note}`);
  for (const a of acts) {
    console.log(`    • [${a.kind}/${a.category}] ${a.title} — ${a.cadence ?? a.recurrence}`);
    console.log(`        → ${a.goal_title ?? '(foundational / whole-plan)'}`);
  }

  const linked = acts.map((a) => norm(a.goal_title ?? ''));
  let covered = 0;
  console.log('  coverage:');
  for (const g of goals) {
    const n = norm(g.title);
    const hit = linked.some((l) => l.length > 0 && (l === n || l.includes(n) || n.includes(l)));
    if (hit) covered++;
    console.log(`    ${hit ? '✓' : '✗ MISSED'}  ${g.title}`);
  }
  console.log(`  → ${covered}/${goals.length} covered`);
  return { covered, total: goals.length, seconds };
}

async function main() {
  const [goals, equipment, user] = await Promise.all([
    listGoalsByStatus(USER, ['captured', 'confirmed', 'committed']),
    listEquipment(USER),
    getUser(USER),
  ]);
  const baseline = user?.baseline ?? {};
  const opts: SynthesizeOpts = { goals, baseline, equipment };

  console.log(`\n=== INPUT: ${goals.length} goals ===`);
  for (const g of goals) console.log(`  • [${g.area}/${g.type}] ${g.title}  (${g.status})`);

  const single = await runPath('SINGLE CALL (synthesizeAndVet)', goals, () => synthesizeAndVet(USER, opts));
  const fanout = await runPath('FAN-OUT → REDUCE (synthesizeFanoutAndVet)', goals, () =>
    synthesizeFanoutAndVet(USER, opts),
  );

  console.log('\n════════ SUMMARY ════════');
  console.log(`  single call: ${single.covered}/${single.total} covered in ${single.seconds.toFixed(1)}s`);
  console.log(`  fan-out:     ${fanout.covered}/${fanout.total} covered in ${fanout.seconds.toFixed(1)}s`);
}

main()
  .then(() => sql.end())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('DRY RUN FAIL:', e);
    await sql.end();
    process.exit(1);
  });
