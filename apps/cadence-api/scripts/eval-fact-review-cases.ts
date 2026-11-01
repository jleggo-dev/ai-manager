/**
 * Fixture files for `npm run eval:fact-review` (HARNESS-V3 C7). Each is the raw rows the service
 * reads — constraints, what they do now, equipment, goals, detours — so the eval goes through the
 * same dossier builder and the same output checks as production. Ids in `expect.cites` are the ones
 * that builder assigns (c = constraint, n = doing now, e = equipment, g = goal, d = detour, each
 * numbered in order; equipment and goals by the day added).
 *
 * The table from the design: a true contradiction, a near-miss that must stay quiet (two dumbbell
 * pairs are both true), stale-by-detour, a duplicate by spelling, and a clean file that must come
 * back empty — plus the second near-miss the prompt names (a knee constraint and a knee brace).
 */
import type { Constraint, Equipment, Goal } from '@cadence/shared';
import type { DossierSources } from '../src/services/fact-review-dossier.ts';
import type { FindingKind } from '../src/services/fact-review-findings.ts';

/** Every case is read as of this day, so a detour's "ended" never drifts with the calendar. */
export const CASE_TODAY = '2026-10-31';

export interface FactReviewCase {
  id: string;
  /** What a reader should see in this file, in a sentence. */
  why: string;
  sources: DossierSources;
  /** null = nothing to report. Otherwise one finding of this kind citing (at least) these facts. */
  expect: { kind: FindingKind; cites: readonly string[] } | null;
}

type Row<T> = T & { created_at?: string };

const eq = (name: string, created_at: string, category: Equipment['category'] = 'strength'): Row<Equipment> => ({
  equipment_id: `zzq-${name}`,
  name,
  category,
  owned: true,
  recommended_by: null,
  linked_goal_ids: [],
  created_at,
});

const goal = (title: string, created_at: string, over: Partial<Goal> = {}): Row<Goal> =>
  ({
    goal_id: `zzq-${title}`,
    title,
    area: 'movement',
    type: 'milestone',
    measure: {},
    timeframe: {},
    status: 'confirmed',
    linked_equipment: [],
    source: 'captured',
    created_at,
    ...over,
  }) as Row<Goal>;

const con = (label: string, over: Partial<Constraint> = {}): Constraint => ({
  id: `zzq-${label}`,
  label,
  kind: 'physical',
  plan_around: true,
  ...over,
});

const file = (over: Partial<DossierSources>): DossierSources => ({
  constraints: [],
  doingNow: [],
  equipment: [],
  goals: [],
  detours: [],
  today: CASE_TODAY,
  ...over,
});

export const FACT_REVIEW_CASES: FactReviewCase[] = [
  {
    id: 'contradiction',
    why: 'A squat rack at home, and an apartment with no equipment at home — both cannot be true now.',
    sources: file({
      constraints: [con('apartment, no equipment at home', { kind: 'life', status: 'active' })],
      doingNow: ['lifts three times a week'],
      equipment: [eq('squat rack and barbell at home', '2026-03-10')],
      goals: [goal('Deadlift 140 kg', '2026-03-12', { type: 'target' })],
    }),
    expect: { kind: 'contradiction', cites: ['e1', 'c1'] },
  },
  {
    id: 'near-miss-dumbbells',
    why: 'Two different dumbbell pairs are both true. Nothing to report.',
    sources: file({
      constraints: [con('left knee — patellar tendinopathy', { status: 'quiet' })],
      doingNow: ['strength work at home twice a week'],
      equipment: [
        eq('20 lb dumbbells', '2026-01-05'),
        eq('35 lb dumbbells', '2026-05-12'),
        eq('adjustable bench', '2026-05-12'),
      ],
      goals: [goal('First strict pull-up', '2026-01-06')],
    }),
    expect: null,
  },
  {
    id: 'stale-by-detour',
    why: 'A gym membership from February, then the gym closed and a June detour — are they back there?',
    sources: file({
      constraints: [con('gym closed for renovation', { kind: 'life', until: '2026-06-30' })],
      doingNow: ['lifts at the gym twice a week'],
      equipment: [eq('gym membership at the community centre', '2026-02-01', 'other')],
      goals: [goal('Squat body weight', '2026-02-03', { type: 'target' })],
      detours: [{ type: 'custom', start: '2026-06-01', end: '2026-06-30' }],
    }),
    expect: { kind: 'stale', cites: ['e1', 'c1'] },
  },
  {
    id: 'duplicate-spelling',
    why: 'One race, written down twice with the words split differently.',
    sources: file({
      constraints: [con('night shifts', { kind: 'life' })],
      equipment: [eq('trail shoes', '2026-02-20', 'footwear')],
      goals: [
        goal('Spartan Ultrabeast', '2026-03-01', { brief: '50 km in Quebec, 30+ obstacles' }),
        goal('Spartan Ultra Beast', '2026-04-02'),
      ],
    }),
    expect: { kind: 'duplicate', cites: ['g1', 'g2'] },
  },
  {
    id: 'clean',
    why: 'A consistent file across all four areas. The expected answer is an empty list.',
    sources: file({
      constraints: [
        con('left knee — patellar tendinopathy', { status: 'quiet' }),
        con('night shifts', { kind: 'life', plan_around: true }),
      ],
      doingNow: ['rows twice a week', 'meditates most mornings'],
      equipment: [
        eq('rowing machine', '2026-01-10', 'cardio'),
        eq('16 kg kettlebell', '2026-01-10'),
        eq('yoga mat', '2026-02-14', 'practice'),
      ],
      goals: [
        goal('Row 2k under 8 minutes', '2026-01-11', { type: 'target' }),
        goal('Meditate 10 minutes a day', '2026-02-14', { area: 'mind', type: 'recurring' }),
      ],
      detours: [{ type: 'travel', start: '2026-08-10', end: '2026-08-17' }],
    }),
    expect: null,
  },
  {
    id: 'near-miss-knee',
    why: 'A knee constraint and a knee brace are both true. Nothing to report.',
    sources: file({
      constraints: [con('left knee pain', { status: 'active' })],
      doingNow: ['walks every day'],
      equipment: [eq('knee brace', '2026-04-01', 'accessory'), eq('foam roller', '2026-04-01', 'accessory')],
      goals: [goal('Run a 10k', '2026-04-02')],
    }),
    expect: null,
  },
];
