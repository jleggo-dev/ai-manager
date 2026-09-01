/**
 * The diff-output evolve path (PLAN-CHANGES.md Phase 1): evolve-plan returns EDITS, code applies
 * them, the same vet gate checks the composed week. These tests pin the routing contract — when
 * the edits land, the whole-week synthesis job is never called; when the edits path dies (rebuild
 * escalation, unparseable output, every edit rejected), the OLD full-synthesis path runs and the
 * fallback is logged with its reason. Mocked at the service layer: src/ai/aim.ts refuses network
 * under vitest by design.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Activity, Goal } from '@cadence/shared';

const runJobBySlug = vi.fn();
const logAi = vi.fn();
const getActivePlan = vi.fn();
const listActivities = vi.fn();
const getActiveEpisode = vi.fn();
const weatherVarsForUser = vi.fn();

vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => runJobBySlug(...a) }));
vi.mock('./ai-log.ts', () => ({ logAi: (...a: unknown[]) => logAi(...a) }));
vi.mock('../repos/plans.ts', () => ({
  getActivePlan: (...a: unknown[]) => getActivePlan(...a),
  supersedeActivePlans: vi.fn(),
  insertPlan: vi.fn(),
}));
vi.mock('../repos/activities.ts', () => ({
  listActivities: (...a: unknown[]) => listActivities(...a),
  insertActivities: vi.fn(),
}));
vi.mock('../repos/episodes.ts', () => ({ getActiveEpisode: (...a: unknown[]) => getActiveEpisode(...a) }));
vi.mock('./weather/weather.ts', () => ({ weatherVarsForUser: (...a: unknown[]) => weatherVarsForUser(...a) }));

const { planEvolve } = await import('./plan-evolve.ts');

const USER = '00000000-0000-4000-a000-00000000e701';

// Handles are the first 8 hex chars of commitment_id (plan-edit.ts activityHandle).
const RUN_ID = 'aaaabbbb-1111-4222-8333-444455556666'; // handle: aaaabbbb
const YOGA_ID = 'bbbbcccc-1111-4222-8333-444455556666'; // handle: bbbbcccc

const GOAL = { goal_id: 'g1', title: 'Run a 10k', area: 'movement', type: 'milestone', status: 'committed' } as Goal;

const activity = (over: Partial<Activity>): Activity =>
  ({
    activity_id: `row-${over.commitment_id}`,
    plan_id: 'p1',
    title: 'Easy run',
    kind: 'user',
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', time_of_day: '07:00', duration_min: 40 },
    completion_source: 'self_report',
    goal_id: 'g1',
    ...over,
  }) as Activity;

const RUN = activity({ commitment_id: RUN_ID, title: 'Easy run' });
const YOGA = activity({
  commitment_id: YOGA_ID,
  title: 'Evening yoga',
  schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', time_of_day: '07:00', duration_min: 30 },
});

const OPTS = {
  goals: [GOAL],
  baseline: {},
  equipment: [],
  currentPlan: [{ title: 'Easy run' }, { title: 'Evening yoga' }],
  recentActivity: { done: 3 },
  userSteer: 'make the run 45 minutes',
};

const reply = (o: unknown) => ({ formatted: JSON.stringify(o) });

/** A fallback week that clears vet + coverage and does NOT trip the density repair pass
 *  (3 user items on one active day meets the floor, so finalizeCoverage stays single-shot). */
const FULL_WEEK = {
  activities: [1, 2, 3].map((n) => ({
    title: `Rebuilt thing ${n}`,
    kind: 'user',
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO', time_of_day: '07:00' },
    goal_title: 'Run a 10k',
  })),
  note: 'rebuilt from scratch',
  rationale: 'the whole week needed a new shape',
};

/** Route job calls by slug; unrouted slugs fail loudly so a surprise call cannot pass silently. */
const routeJobs = (bySlug: Record<string, unknown>) => {
  runJobBySlug.mockImplementation(async (_u: unknown, slug: string) => {
    if (slug in bySlug) return reply(bySlug[slug]);
    throw new Error(`unexpected job ${slug}`);
  });
};

const calledSlugs = () => runJobBySlug.mock.calls.map((c) => c[1] as string);

const fellBackWith = (why: string) =>
  logAi.mock.calls.some(([, e]) => {
    const entry = e as { kind: string; output?: { fell_back?: boolean; why?: string } };
    return entry.kind === 'evolve_plan' && entry.output?.fell_back === true && entry.output?.why === why;
  });

beforeEach(() => {
  vi.clearAllMocks();
  logAi.mockResolvedValue(undefined);
  getActivePlan.mockResolvedValue({ plan_id: 'p1', version: 3 });
  listActivities.mockResolvedValue([RUN, YOGA]);
  getActiveEpisode.mockResolvedValue(null);
  weatherVarsForUser.mockResolvedValue({ weather: '', weather_temp_c: '' });
});

describe('planEvolve — the edits path', () => {
  it('applies the returned edits to the active plan, vets the composed week, and never calls whole-week synthesis', async () => {
    routeJobs({
      'evolve-plan': {
        edits: [
          { action: 'resize', activities: ['aaaabbbb'], duration_min: 45 },
          { action: 'retime', activities: ['bbbbcccc'], time_of_day: '18:00' },
        ],
        note: 'Lengthened the run and moved yoga to the evening.',
        rationale: 'I nudged two things.',
      },
      'plan-vet': { valid: true },
    });

    const res = await planEvolve(USER, OPTS);

    expect(res.status).toBe('proposed');
    const run = res.activities!.find((a) => a.title === 'Easy run')!;
    expect(run.duration_min).toBe(45);
    expect(run.commitment_id).toBe(RUN_ID); // lineage rides through (0036)
    const yoga = res.activities!.find((a) => a.title === 'Evening yoga')!;
    expect(yoga.time_of_day).toBe('18:00');
    expect(res.note).toBe('Lengthened the run and moved yoga to the evening.');
    expect(res.rationale).toBe('I nudged two things.');
    expect(calledSlugs()).not.toContain('synthesize-plan');

    // The job saw the SAME handles applyPlanEdits resolves — one derivation, never two.
    const evolveVars = runJobBySlug.mock.calls.find((c) => c[1] === 'evolve-plan')![2] as { current_plan: string };
    const currentPlan = JSON.parse(evolveVars.current_plan) as Array<{ handle: string; goal_title?: string }>;
    expect(currentPlan.map((c) => c.handle)).toEqual(['aaaabbbb', 'bbbbcccc']);
    expect(currentPlan[0]!.goal_title).toBe('Run a 10k');

    // The vet judged the COMPOSED week (the edit already applied), not the old one.
    const vetVars = runJobBySlug.mock.calls.find((c) => c[1] === 'plan-vet')![2] as { proposed_plan: string };
    const vetted = JSON.parse(vetVars.proposed_plan) as {
      activities: Array<{ title: string; schedule: { duration_min?: number } }>;
    };
    expect(vetted.activities.find((a) => a.title === 'Easy run')!.schedule.duration_min).toBe(45);

    // The measurement row: edits path, nothing fell back.
    expect(
      logAi.mock.calls.some(([, e]) => {
        const m = (e as { meta?: { path?: string; ok?: boolean; edits_applied?: number } }).meta;
        return m?.path === 'edits' && m?.ok === true && m?.edits_applied === 2;
      }),
    ).toBe(true);
  });

  it('proceeds with what applied when one edit is rejected, and says so in a plain sentence', async () => {
    routeJobs({
      'evolve-plan': {
        edits: [
          { action: 'resize', activities: ['aaaabbbb'], duration_min: 45 },
          { action: 'resize', activities: ['deadbeef'], duration_min: 30 }, // no such handle
        ],
        note: 'Two resizes.',
        rationale: 'r',
      },
      'plan-vet': { valid: true },
    });

    const res = await planEvolve(USER, OPTS);

    expect(res.status).toBe('proposed');
    expect(res.activities!.find((a) => a.title === 'Easy run')!.duration_min).toBe(45);
    expect(res.note).toContain('Two resizes.');
    expect(res.note).toContain('could not be applied');
    expect(calledSlugs()).not.toContain('synthesize-plan'); // partial rejection is NOT a fallback
  });

  it('surfaces a vet veto with its violations, same shape as the synthesis path', async () => {
    routeJobs({
      'evolve-plan': {
        edits: [{ action: 'resize', activities: ['aaaabbbb'], duration_min: 45 }],
        note: 'n',
        rationale: 'r',
      },
      'plan-vet': { valid: false, violations: ['loads the knee they are working around'] },
    });

    const res = await planEvolve(USER, OPTS);

    expect(res).toEqual({ status: 'vetoed', violations: ['loads the knee they are working around'] });
    expect(calledSlugs()).not.toContain('synthesize-plan'); // a veto is an answer, not a fallback
  });
});

describe('planEvolve — fallbacks (the old path, logged never silent)', () => {
  it('rebuild:true escalates to the full synthesis evolve', async () => {
    routeJobs({
      'evolve-plan': { rebuild: true, note: 'the week no longer matches the goals' },
      'synthesize-plan': FULL_WEEK,
      'plan-vet': { valid: true },
    });

    const res = await planEvolve(USER, OPTS);

    expect(res.status).toBe('proposed');
    expect(res.activities).toHaveLength(3);
    expect(res.note).toBe('rebuilt from scratch');
    expect(calledSlugs()).toContain('synthesize-plan');
    expect(fellBackWith('rebuild')).toBe(true);
  });

  it('unparseable output falls back to the full synthesis evolve', async () => {
    runJobBySlug.mockImplementation(async (_u: unknown, slug: string) => {
      if (slug === 'evolve-plan') return { formatted: 'sorry, here is prose instead of JSON' };
      if (slug === 'synthesize-plan') return reply(FULL_WEEK);
      if (slug === 'plan-vet') return reply({ valid: true });
      throw new Error(`unexpected job ${slug}`);
    });

    const res = await planEvolve(USER, OPTS);

    expect(res.status).toBe('proposed');
    expect(calledSlugs()).toContain('synthesize-plan');
    expect(fellBackWith('unparseable')).toBe(true);
  });

  it('every edit rejected falls back to the full synthesis evolve', async () => {
    routeJobs({
      'evolve-plan': {
        edits: [{ action: 'resize', activities: ['deadbeef'], duration_min: 30 }], // no such handle
        note: 'n',
        rationale: 'r',
      },
      'synthesize-plan': FULL_WEEK,
      'plan-vet': { valid: true },
    });

    const res = await planEvolve(USER, OPTS);

    expect(res.status).toBe('proposed');
    expect(calledSlugs()).toContain('synthesize-plan');
    expect(fellBackWith('no_applied_edits')).toBe(true);
  });
});
