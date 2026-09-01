/**
 * Diff-aware commit invalidation (PLAN-CHANGES.md Phase 1), against a REAL commit transaction.
 *
 * The claim under test: a commit invalidates only the occurrences of activities the diff touched.
 * Unchanged activities keep their future pending occurrences — same occurrence_id, cached session
 * intact, re-pointed at the new plan version's activity rows — and a byte-identical recommit
 * (build_next_week's roll-forward is exactly that) wipes NOTHING, so the warm-up has nothing to
 * re-author. Same harness as plan-commit.test.ts: real Cadence Postgres, own per-process test
 * user, only the AI seam mocked (no live model call, no @ai-admin/core load); skips cleanly when
 * no Cadence DB is configured.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { OccurrenceSession, PendingPlanActivity } from '@cadence/shared';
import { testUserId } from './test-user.ts';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a111');

// Fully replace the AI seam: the commit path itself never calls a job, and the background
// warm-up's prescribe call must go nowhere (an undefined mock result reads as a failed
// generation, which the prefetch swallows — nothing gets cached behind the test's back).
vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

let sql: (typeof import('../db/sql.ts'))['sql'];
let cadenceConfig: (typeof import('../config.ts'))['cadenceConfig'];
let commitActivities: (typeof import('./plan-synthesis.ts'))['commitActivities'];
let getActivePlan: (typeof import('../repos/plans.ts'))['getActivePlan'];
let listActivities: (typeof import('../repos/activities.ts'))['listActivities'];
let listOccurrences: (typeof import('../repos/occurrences.ts'))['listOccurrences'];
let getOccurrenceWithActivity: (typeof import('../repos/occurrences.ts'))['getOccurrenceWithActivity'];
let setOccurrenceSessionIfEmpty: (typeof import('../repos/occurrence-sessions.ts'))['setOccurrenceSessionIfEmpty'];
let insertGoal: (typeof import('../repos/goals.ts'))['insertGoal'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

const today = () => new Date().toISOString().slice(0, 10);
const plus7 = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
/** listOccurrences selects the raw date column, which the driver may hand back as a Date. */
const iso = (date: unknown): string =>
  date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);

/** Two commitments: a daily one (guaranteed future rows to stamp) and a twice-weekly one. */
function weekActs(goalId: string): PendingPlanActivity[] {
  return [
    {
      title: 'Easy run',
      kind: 'user',
      cadence: 'daily',
      recurrence: 'FREQ=DAILY',
      time_of_day: '06:30',
      duration_min: 40,
      completion_source: 'self_report',
      goal_id: goalId,
      why: 'builds your aerobic base',
    },
    {
      title: 'Mobility',
      kind: 'user',
      cadence: 'weekly',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO,TH',
      time_of_day: '07:00',
      completion_source: 'self_report',
      goal_id: goalId,
    },
  ];
}

function stampSession(): OccurrenceSession {
  return {
    blocks: [{ label: 'Main', items: [{ name: 'Easy pace, conversational' }] }],
    note: 'stamped by test',
    generated_at: new Date().toISOString(),
    version: 1,
  };
}

async function seedGoal(): Promise<string> {
  const g = await insertGoal(USER, {
    title: 'Run a 5k',
    area: 'movement',
    type: 'target',
    status: 'confirmed',
    measure: { metric: 'distance', target: 5, unit: 'km' },
    timeframe: {},
    linked_equipment: [],
    source: 'manual',
  });
  return g.goal_id;
}

d('diff-aware commit invalidation', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ cadenceConfig } = await import('../config.ts'));
    ({ commitActivities } = await import('./plan-synthesis.ts'));
    ({ getActivePlan } = await import('../repos/plans.ts'));
    ({ listActivities } = await import('../repos/activities.ts'));
    ({ listOccurrences, getOccurrenceWithActivity } = await import('../repos/occurrences.ts'));
    ({ setOccurrenceSessionIfEmpty } = await import('../repos/occurrence-sessions.ts'));
    ({ insertGoal } = await import('../repos/goals.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
  });

  afterAll(async () => {
    if (resetUserData) await resetUserData(USER);
    if (sql) await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await resetUserData(USER);
    cadenceConfig.commitDiff = true;
  });

  it('a byte-identical recommit wipes ZERO occurrences — rows, ids, and cached sessions all survive', async () => {
    const goalId = await seedGoal();
    await commitActivities(USER, { activities: weekActs(goalId), note: 'v1', goalIds: [goalId] });
    const plan1 = await getActivePlan(USER);

    const before = await listOccurrences(USER, today(), plus7());
    expect(before.length).toBeGreaterThan(0);
    const target = before.find((o) => iso(o.date) > today())!;
    expect(target).toBeTruthy();
    expect(await setOccurrenceSessionIfEmpty(USER, target.occurrence_id, stampSession())).toBe(true);

    // build_next_week's roll-forward: the exact same activities, committed again as v+1.
    const r2 = await commitActivities(USER, { activities: weekActs(goalId), note: 'v2', goalIds: [goalId] });
    expect(r2.status).toBe('committed');
    expect(r2.occurrencesWiped).toBe(0);
    expect(r2.occurrencesSurvived).toBe(before.length);

    // Same rows, not equivalent ones: every occurrence_id survives the commit.
    const after = await listOccurrences(USER, today(), plus7());
    expect(new Set(after.map((o) => o.occurrence_id))).toEqual(new Set(before.map((o) => o.occurrence_id)));

    // The cached session rode along, and the row now belongs to the NEW plan's activity.
    const detail = await getOccurrenceWithActivity(USER, target.occurrence_id);
    expect(detail?.session?.note).toBe('stamped by test');
    const plan2 = await getActivePlan(USER);
    expect(plan2!.plan_id).not.toBe(plan1!.plan_id);
    const newActivityIds = (await listActivities(plan2!.plan_id)).map((a) => a.activity_id);
    expect(newActivityIds).toContain(detail!.activity_id);
  });

  it('a one-activity edit invalidates only that activity — a reworded why costs nothing', async () => {
    const goalId = await seedGoal();
    await commitActivities(USER, { activities: weekActs(goalId), note: 'v1', goalIds: [goalId] });
    const plan1 = await getActivePlan(USER);
    const acts1 = await listActivities(plan1!.plan_id);
    const runId = acts1.find((a) => a.title === 'Easy run')!.activity_id;
    const mobId = acts1.find((a) => a.title === 'Mobility')!.activity_id;

    const before = await listOccurrences(USER, today(), plus7());
    const runRows = before.filter((o) => o.activity_id === runId);
    const mobRows = before.filter((o) => o.activity_id === mobId);
    const target = runRows.find((o) => iso(o.date) > today())!;
    expect(await setOccurrenceSessionIfEmpty(USER, target.occurrence_id, stampSession())).toBe(true);

    // The run changes only its `why` (prescriptions never read it); Mobility moves to evenings
    // (time_of_day feeds prescribe-session, so its sessions genuinely need re-authoring).
    const v2 = weekActs(goalId).map((a) =>
      a.title === 'Easy run' ? { ...a, why: 'a whole new rationale' } : { ...a, time_of_day: '18:00' },
    );
    const r2 = await commitActivities(USER, { activities: v2, note: 'v2', goalIds: [goalId] });
    expect(r2.occurrencesSurvived).toBe(runRows.length);
    expect(r2.occurrencesWiped).toBe(mobRows.length);

    // The run's rows and stamped session survived; Mobility's were re-materialized as new rows.
    const after = await listOccurrences(USER, today(), plus7());
    const afterIds = new Set(after.map((o) => o.occurrence_id));
    for (const o of runRows) expect(afterIds.has(o.occurrence_id)).toBe(true);
    for (const o of mobRows) expect(afterIds.has(o.occurrence_id)).toBe(false);
    expect((await getOccurrenceWithActivity(USER, target.occurrence_id))?.session?.note).toBe('stamped by test');

    // The re-pointed run rows now hang off the new plan's activity; the reworded why reaches
    // them through that join without a single session re-authored.
    const acts2 = await listActivities((await getActivePlan(USER))!.plan_id);
    const newRun = acts2.find((a) => a.title === 'Easy run')!;
    expect(newRun.why).toBe('a whole new rationale');
    expect((await getOccurrenceWithActivity(USER, target.occurrence_id))?.activity_id).toBe(newRun.activity_id);
    // Mobility's replacement rows exist (same cadence, fresh ids) and are cold.
    const newMobRows = after.filter((o) => o.activity_id === acts2.find((a) => a.title === 'Mobility')!.activity_id);
    expect(newMobRows.length).toBe(mobRows.length);
    for (const o of newMobRows) expect(o.has_session).toBe(false);
  });

  it('CADENCE_COMMIT_DIFF=0 restores the old wipe-everything commit', async () => {
    const goalId = await seedGoal();
    await commitActivities(USER, { activities: weekActs(goalId), note: 'v1', goalIds: [goalId] });
    const before = await listOccurrences(USER, today(), plus7());
    const target = before.find((o) => iso(o.date) > today())!;
    expect(await setOccurrenceSessionIfEmpty(USER, target.occurrence_id, stampSession())).toBe(true);

    cadenceConfig.commitDiff = false; // what the env kill switch sets at boot
    try {
      const r2 = await commitActivities(USER, { activities: weekActs(goalId), note: 'v2', goalIds: [goalId] });
      expect(r2.occurrencesSurvived).toBe(0);
      expect(r2.occurrencesWiped).toBe(before.length);
    } finally {
      cadenceConfig.commitDiff = true;
    }
    // The stamped row is gone with everything else — the old behavior, byte for byte.
    expect(await getOccurrenceWithActivity(USER, target.occurrence_id)).toBeNull();
  });
});
