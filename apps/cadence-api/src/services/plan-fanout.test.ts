/**
 * Unit tests for the fan-out → reduce synthesis path. Fully mocks the AI seam (runJob) and the DB
 * (never touched here), so these run deterministically in CI without CADENCE or AI-Manager secrets.
 * synthesize vs. vet, and per-goal draft vs. reduce, are told apart by the job INPUTS (not the slug,
 * which is '' without secrets): vet passes `proposed_plan`; the reduce passes non-empty
 * `draft_activities`; a per-goal draft passes a single-goal `goals` array.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Goal } from '@cadence/shared';

// config.ts throws at import without DB creds (CI has none). A dummy URL keeps it from throwing;
// no query ever runs here (runJob + db are mocked). Hoisted so it beats the transitive config load.
vi.hoisted(() => {
  process.env.CADENCE_DATABASE_URL ||= 'postgres://u:p@localhost:5432/test';
});

vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));
vi.mock('../db/sql.ts', () => ({ sql: {}, json: (v: unknown) => v }));

import * as aim from '../ai/aim.ts';
import { synthesizeFanoutAndVet } from './plan-fanout.ts';
import { synthesizeAndVet } from './plan-synthesis.ts';

const runJob = aim.runJob as unknown as ReturnType<typeof vi.fn>;

const USER = 'u1';
const goal = (goal_id: string, title: string): Goal => ({ goal_id, title }) as Goal;
const A = goal('a', 'Run a 10k');
const B = goal('b', 'Lose weight');
const C = goal('c', 'Stop drinking');

type Vars = Record<string, string>;
const synthResp = (activities: unknown[], note = 'ok') => ({ formatted: JSON.stringify({ activities, note }) });
const vetOk = { formatted: JSON.stringify({ verified: true, valid: true }) };
const activityFor = (goal_title: string) => ({
  title: `Do ${goal_title}`,
  kind: 'user',
  category: 'movement',
  schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO', time_of_day: '07:00' },
  goal_title,
});

const isVet = (v: Vars) => typeof v.proposed_plan === 'string';
const isReduce = (v: Vars) => v.draft_activities !== undefined && v.draft_activities !== '""';
const vars = (call: unknown[]) => call[2] as Vars;

// Block body (not `() => mockReset()`): a hook that RETURNS the mock (a callable) makes vitest treat
// it as a teardown and invoke runJob() with zero args.
beforeEach(() => {
  runJob.mockReset();
});

describe('synthesizeFanoutAndVet', () => {
  it('drafts each goal, primes the reduce with all drafts, and covers every goal', async () => {
    runJob.mockImplementation(async (_u: string, _slug: string, v: Vars) => {
      if (isVet(v)) return vetOk;
      if (isReduce(v)) return synthResp(['Run a 10k', 'Lose weight', 'Stop drinking'].map(activityFor));
      return synthResp([activityFor((JSON.parse(v.goals ?? '[]') as Goal[])[0]!.title)]); // per-goal draft
    });

    const res = await synthesizeFanoutAndVet(USER, { goals: [A, B, C], baseline: {}, equipment: [] });
    expect(res.status).toBe('proposed');
    expect(res.activities?.map((a) => a.goal_id).sort()).toEqual(['a', 'b', 'c']);

    // One focused draft call per goal.
    const draftCalls = runJob.mock.calls.filter((c) => !isVet(vars(c)) && !isReduce(vars(c)));
    expect(draftCalls).toHaveLength(3);

    // The reduce was primed with all three drafts.
    const reduceCall = runJob.mock.calls.find((c) => isReduce(vars(c)));
    expect(reduceCall).toBeTruthy();
    expect(JSON.parse(vars(reduceCall!).draft_activities ?? '[]')).toHaveLength(3);
  });

  it('recovers a goal the reduce dropped from its own draft — no extra model call', async () => {
    runJob.mockImplementation(async (_u: string, _slug: string, v: Vars) => {
      if (isVet(v)) return vetOk;
      if (isReduce(v)) return synthResp(['Run a 10k', 'Stop drinking'].map(activityFor)); // drops B
      return synthResp([activityFor((JSON.parse(v.goals ?? '[]') as Goal[])[0]!.title)]);
    });

    const res = await synthesizeFanoutAndVet(USER, { goals: [A, B, C], baseline: {}, equipment: [] });
    expect(res.status).toBe('proposed');
    expect(res.activities?.map((a) => a.goal_id).sort()).toEqual(['a', 'b', 'c']);
    // Recovery reused B's existing draft, so synth calls stay at 3 drafts + 1 reduce (no re-synthesis).
    expect(runJob.mock.calls.filter((c) => !isVet(vars(c)))).toHaveLength(4);
  });

  it('vetoes when the reduce returns nothing', async () => {
    runJob.mockImplementation(async (_u: string, _slug: string, v: Vars) => {
      if (isVet(v)) return vetOk;
      if (isReduce(v)) return synthResp([]);
      return synthResp([activityFor((JSON.parse(v.goals ?? '[]') as Goal[])[0]!.title)]);
    });
    const res = await synthesizeFanoutAndVet(USER, { goals: [A, B], baseline: {}, equipment: [] });
    expect(res.status).toBe('vetoed');
  });
});

describe('synthesizeAndVet coverage veto (single-call path)', () => {
  it('vetoes naming the goal when the call and its one repair both miss it', async () => {
    runJob.mockImplementation(async (_u: string, _slug: string, v: Vars) => {
      if (isVet(v)) return vetOk;
      const goals = JSON.parse(v.goals ?? '[]') as Goal[];
      if (goals.length === 1) return synthResp([]); // repair for the missing goal finds nothing
      return synthResp([activityFor('Run a 10k')]); // initial call covers A only
    });

    const res = await synthesizeAndVet(USER, { goals: [A, B], baseline: {}, equipment: [] });
    expect(res.status).toBe('vetoed');
    expect(res.violations?.join(' ')).toContain('Lose weight');
  });
});
