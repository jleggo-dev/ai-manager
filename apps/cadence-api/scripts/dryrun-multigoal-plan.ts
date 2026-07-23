/**
 * READ-ONLY dry run: does a SINGLE synthesize_plan call produce a balanced plan when handed
 * ALL of a real user's goals? Answers the "one call vs. per-goal fan-out" question with evidence.
 *
 * Loads the user's real goals (any status) + baseline + equipment, runs synthesizeAndVet
 * (Coach → plan_vet), and prints the proposal + a per-goal COVERAGE check. Writes NOTHING to the
 * DB — synthesizeAndVet returns a proposal; only commitActivities (not called here) persists.
 *
 * Run: node --import tsx apps/cadence-api/scripts/dryrun-multigoal-plan.ts [userId]
 */
import { listGoalsByStatus } from '../src/repos/goals.ts';
import { listEquipment } from '../src/repos/equipment.ts';
import { getUser } from '../src/repos/users.ts';
import { synthesizeAndVet } from '../src/services/plan-synthesis.ts';
import { sql } from '../src/db/sql.ts';

const USER = process.argv[2] ?? 'b33b0b6e-2f22-4211-a635-96188c31af7f';

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function main() {
  const [goals, equipment, user] = await Promise.all([
    listGoalsByStatus(USER, ['captured', 'confirmed', 'committed']),
    listEquipment(USER),
    getUser(USER),
  ]);
  const baseline = user?.baseline ?? {};

  console.log(`\n=== INPUT: ${goals.length} goals fed to ONE synthesize_plan call ===`);
  for (const g of goals) console.log(`  • [${g.area}/${g.type}] ${g.title}  (${g.status})`);
  const constraints = (baseline as { constraints?: Array<{ label: string; plan_around?: boolean }> }).constraints ?? [];
  console.log(
    `  baseline: ${constraints.map((c) => c.label + (c.plan_around ? ' (plan around)' : '')).join(', ') || '—'}`,
  );
  console.log(`  equipment: ${equipment.length} tools`);

  console.log('\n=== Running Coach synthesize_plan → Broker plan_vet (first-plan simulation) ===');
  const t0 = Date.now();
  const res = await synthesizeAndVet(USER, { goals, baseline, equipment });
  console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)  status=${res.status}`);

  if (res.status === 'vetoed') {
    console.log('  VETOED:', res.violations?.join('; '));
    return;
  }

  const acts = res.activities ?? [];
  console.log(`\n=== PROPOSED PLAN: ${acts.length} activities ===`);
  console.log(`note: ${res.note}\n`);
  for (const a of acts) {
    console.log(`  • [${a.kind}/${a.category}] ${a.title}`);
    console.log(`      ${a.cadence ?? a.recurrence}${a.time_of_day ? ' @ ' + a.time_of_day : ''}`);
    console.log(`      → goal: ${a.goal_title ?? '(foundational / whole-plan)'}`);
    if (a.why) console.log(`      why: ${a.why}`);
  }

  // COVERAGE — the metric that answers the per-goal question: did the single call give EVERY goal
  // at least one commitment, or did it drop some?
  console.log('\n=== COVERAGE (per-goal) ===');
  const linked = acts.map((a) => norm(a.goal_title ?? ''));
  let covered = 0;
  for (const g of goals) {
    const n = norm(g.title);
    const hit = linked.some((l) => l.length > 0 && (l === n || l.includes(n) || n.includes(l)));
    if (hit) covered++;
    console.log(`  ${hit ? '✓' : '✗ MISSED'}  ${g.title}`);
  }
  const systemActs = acts.filter((a) => a.kind === 'system').map((a) => a.title);
  console.log(`\n  goals covered: ${covered}/${goals.length}`);
  console.log(`  system activities (weigh-in / food log / check-in): ${systemActs.join(', ') || '(none)'}`);
}

main()
  .then(() => sql.end())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('DRY RUN FAIL:', e);
    await sql.end();
    process.exit(1);
  });
