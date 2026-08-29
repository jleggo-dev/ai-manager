/**
 * Pure render/rows coverage for the retrieval semantic layer (API-P2).
 * Mocks repo/DB imports so CI never needs CADENCE_* env — fixtures only.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ProgressCard } from '@cadence/shared';

vi.mock('../../repos/users.ts', () => ({ getUser: vi.fn() }));
vi.mock('../../repos/goals.ts', () => ({ listGoalsByStatus: vi.fn(), listGoals: vi.fn() }));
vi.mock('../../repos/equipment.ts', () => ({ listEquipment: vi.fn() }));
vi.mock('../../repos/plans.ts', () => ({ getActivePlan: vi.fn() }));
vi.mock('../../repos/activities.ts', () => ({ listActivities: vi.fn() }));
vi.mock('../../repos/occurrences.ts', () => ({ listOccurrences: vi.fn(), listRecentLogged: vi.fn() }));
vi.mock('../../repos/nutrition.ts', () => ({ listNutritionLogs: vi.fn() }));
vi.mock('../../repos/journal-entries.ts', () => ({ listForCoach: vi.fn() }));
vi.mock('../progress.ts', () => ({ buildProgress: vi.fn() }));
vi.mock('../food-sources/usda-enrich.ts', () => ({ searchFoodsWithUsda: vi.fn() }));
// Backstop: the per-repo mocks above have to stay exhaustive, and adding one import to registry.ts
// silently broke that (edc1fb8 added journal-entries; CI went red, every dev machine stayed green
// because a local .env always has CADENCE_* set). Mocking the shared DB seam means the NEXT repo
// added to registry.ts can't reintroduce the same failure.
vi.mock('../../db/sql.ts', () => ({ sql: vi.fn(), json: vi.fn() }));
vi.mock('../nutrition-summarize.ts', async (orig) => {
  const real = await orig<typeof import('../nutrition-summarize.ts')>();
  return real;
});

import { RETRIEVAL_FUNCTIONS } from './registry.ts';
import { searchFoodsWithUsda } from '../food-sources/usda-enrich.ts';
import { getActivePlan } from '../../repos/plans.ts';
import { listActivities } from '../../repos/activities.ts';
import { listGoals } from '../../repos/goals.ts';

describe('retrieval registry — render / rows', () => {
  it('get_identity asks for a name when missing', () => {
    expect(RETRIEVAL_FUNCTIONS.get_identity!.render({ name: null })).toMatch(/ask the user their name/);
    expect(RETRIEVAL_FUNCTIONS.get_identity!.rows({ name: null })).toBe(0);
    expect(RETRIEVAL_FUNCTIONS.get_identity!.render({ name: 'Alex' })).toBe('Name: Alex');
    expect(RETRIEVAL_FUNCTIONS.get_identity!.rows({ name: 'Alex' })).toBe(1);
  });

  it('get_objectives formats measure + status (committed, not locked)', () => {
    const goals = [
      {
        title: 'First 10k',
        area: 'movement',
        type: 'milestone',
        status: 'committed',
        measure: { target: 10, unit: 'km' },
      },
    ];
    const text = RETRIEVAL_FUNCTIONS.get_objectives!.render(goals);
    expect(text).toContain('Objectives (1)');
    expect(text).toContain('First 10k');
    expect(text).toContain('committed');
    expect(text).toContain('target 10 km');
    expect(RETRIEVAL_FUNCTIONS.get_objectives!.rows(goals)).toBe(1);
    expect(RETRIEVAL_FUNCTIONS.get_objectives!.render([])).toBe('');
  });

  it('get_objectives catalog description uses committed (not locked)', () => {
    expect(RETRIEVAL_FUNCTIONS.get_objectives!.description).toMatch(/committed/);
    expect(RETRIEVAL_FUNCTIONS.get_objectives!.description).not.toMatch(/locked/);
  });

  /**
   * The plan read has to say WHEN — and has to say so when nobody has said when.
   *
   * Until 2026-08-17 the line was handle + kind + title + the raw recurrence rule, so a commitment
   * whose `time_of_day` was NULL rendered identically to one at 07:00. The owner asked three times
   * why his Tuesday run had no time on it; the coach could not see that anything was missing, so
   * she never offered to fix it. Everything below is that read, one state at a time.
   */
  const commitment = (over: Record<string, unknown>) => ({
    commitment_id: '8b8a10d0-1111-2222-3333-444455556666',
    kind: 'user',
    title: 'Easy run',
    goal_id: 'g-move',
    ...over,
  });
  const planRender = (activities: Array<Record<string, unknown>>, areaByGoal: Record<string, string> = {}) =>
    RETRIEVAL_FUNCTIONS.get_active_plan!.render({ plan: { version: 2 }, activities, areaByGoal });

  it('get_active_plan omits when there is no plan', () => {
    expect(RETRIEVAL_FUNCTIONS.get_active_plan!.render({ plan: null, activities: [] })).toBe('');
  });

  it('a timed commitment reads day, clock time, the effort, and the time to set aside', () => {
    const text = planRender(
      [commitment({ schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', time_of_day: '07:00', duration_min: 40 } })],
      { 'g-move': 'movement' },
    );
    expect(text).toContain('Current plan v2');
    // `duration_min` is the EFFORT since the owner's ruling, so the number is named rather than
    // left to be read as the whole slot, and the derived total says what to actually block out.
    expect(text).toContain('  - 8b8a10d0 [user] Easy run — Tue · 07:00 · 40 min effort (allow 50)');
  });

  /** A choice someone made. It must not read like the hole below it. */
  it('an "anytime" commitment reads as any time', () => {
    const text = planRender(
      [
        commitment({
          title: 'Evening sit',
          goal_id: 'g-mind',
          schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: 'anytime', duration_min: 20 },
        }),
      ],
      { 'g-mind': 'mind' },
    );
    expect(text).toContain('Evening sit — Mon, Wed, Fri · any time · 20 min effort (allow 25)');
    expect(text).not.toContain('no time set');
  });

  /** The bug itself: a NULL time was invisible. It is now the loudest thing on the line. */
  it('a commitment with no time at all says so, and stays distinct from "any time"', () => {
    const text = planRender([commitment({ schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', duration_min: 40 } })], {
      'g-move': 'movement',
    });
    expect(text).toContain('Easy run — Tue · no time set · 40 min effort (allow 50)');
    expect(text).not.toContain('any time');
  });

  it('an empty string is a hole too — a blank time is not a time', () => {
    expect(
      planRender([commitment({ schedule: { recurrence: 'FREQ=DAILY;INTERVAL=2', time_of_day: '  ' } })]),
    ).toContain('Easy run — Every other day · no time set');
  });

  /**
   * The recurrence rule is developer noise the coach can neither read reliably nor write back:
   * `propose_plan_change` addresses days as words. `describeRecurrence` is the app's one humaniser
   * and runs on the same parser that materializes the calendar, so nothing actionable is lost.
   */
  it('the raw recurrence rule never reaches the coach', () => {
    const text = planRender([
      commitment({ schedule: { recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', time_of_day: '18:30' } }),
    ]);
    expect(text).not.toContain('FREQ=');
    expect(text).not.toContain('BYDAY');
    expect(text).toContain('Easy run — Every other week · Mon · 18:30');
  });

  it('two same-titled commitments are told apart by handle, day and time', () => {
    const text = planRender([
      commitment({ schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU' } }),
      commitment({
        commitment_id: 'c1d2e3f4-9999-8888-7777-666655554444',
        schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=WE', time_of_day: '06:15' },
      }),
    ]);
    expect(text).toContain('  - 8b8a10d0 [user] Easy run — Tue · no time set');
    expect(text).toContain('  - c1d2e3f4 [user] Easy run — Wed · 06:15');
  });

  it('says nothing extra when there is nothing extra to say — no duration, no goal, no repeat', () => {
    const text = planRender([
      commitment({
        title: 'Weigh in',
        goal_id: undefined,
        schedule: { recurrence: 'FREQ=DAILY', time_of_day: '07:30' },
      }),
      commitment({
        commitment_id: 'ffffffff-0000-0000-0000-000000000000',
        title: 'Off-plan',
        kind: 'system',
        schedule: { recurrence: '' },
      }),
    ]);
    expect(text).toContain('Weigh in — Every day · 07:30');
    expect(text).not.toContain('min effort');
    // A blank rule never fires, so "One-time" would be a lie about the week.
    expect(text).toContain('Off-plan — no repeat set · no time set');
  });

  /** The area lives on the GOAL, not the commitment, so the read has to resolve it or the derived
   *  total is silently wrong — 20 minutes of sitting would be budgeted at 20, not 25. */
  it('get_active_plan.run resolves each commitment area so the total is right', async () => {
    vi.mocked(getActivePlan).mockResolvedValue({ plan_id: 'p1', version: 3 } as never);
    vi.mocked(listActivities).mockResolvedValue([
      commitment({
        title: 'Evening sit',
        goal_id: 'g-mind',
        schedule: { recurrence: 'FREQ=DAILY', time_of_day: '21:00', duration_min: 20 },
      }),
    ] as never);
    vi.mocked(listGoals).mockResolvedValue([{ goal_id: 'g-mind', area: 'mind' }] as never);

    const result = await RETRIEVAL_FUNCTIONS.get_active_plan!.run('u1');
    expect(RETRIEVAL_FUNCTIONS.get_active_plan!.render(result)).toContain(
      'Evening sit — Every day · 21:00 · 20 min effort (allow 25)',
    );
    expect(RETRIEVAL_FUNCTIONS.get_active_plan!.rows(result)).toBe(1);
  });

  /** This runs on every turn. With no plan there is nothing for an area to belong to, so the
   *  goals read must not happen at all. */
  it('get_active_plan.run reads nothing else when there is no plan', async () => {
    vi.mocked(getActivePlan).mockResolvedValue(null as never);
    vi.mocked(listActivities).mockClear();
    vi.mocked(listGoals).mockClear();
    expect(await RETRIEVAL_FUNCTIONS.get_active_plan!.run('u1')).toEqual({
      plan: null,
      activities: [],
      areaByGoal: {},
    });
    expect(listActivities).not.toHaveBeenCalled();
    expect(listGoals).not.toHaveBeenCalled();
  });

  it('get_consistency omits when nothing scheduled', () => {
    expect(RETRIEVAL_FUNCTIONS.get_consistency!.render({ days: 7, scheduled: 0, done: 0, pct: null })).toBe('');
    expect(RETRIEVAL_FUNCTIONS.get_consistency!.render({ days: 7, scheduled: 4, done: 2, pct: 50 })).toBe(
      'Consistency (last 7d): 50% (2/4 showed up)',
    );
  });

  it('get_goal_progress covers each ProgressCard kind + trends', () => {
    const cards: ProgressCard[] = [
      { kind: 'count', area: 'mind', title: 'Books', goal_id: 'g1', current: 3, target: 12, unit: 'books' },
      {
        kind: 'latest_vs_target',
        area: 'nourishment',
        title: 'Weight',
        unit: 'kg',
        latest: 80,
        start: 90,
        target: 75,
        series: [],
      },
      {
        kind: 'countdown',
        area: 'movement',
        title: 'Race',
        end: '2026-09-01',
        days_left: 40,
        milestones_done: 1,
        milestones_total: 3,
      },
      { kind: 'consistency', area: 'practice', title: 'Prayer', kept: 4, window: 7 },
    ];
    const trends = [{ title: 'Squat', label: 'Top load', unit: 'kg', first: { value: 60 }, last: { value: 80 } }];
    const text = RETRIEVAL_FUNCTIONS.get_goal_progress!.render({ cards, trends });
    expect(text).toContain('3/12 books');
    expect(text).toContain('now 80 kg');
    expect(text).toContain('40 days out');
    expect(text).toContain('showed up 4 of 7 days');
    expect(text).toContain('60 → 80 kg');
    expect(RETRIEVAL_FUNCTIONS.get_goal_progress!.rows({ cards, trends })).toBe(5);
  });

  it('get_constraints prefers label and marks plan-around', () => {
    const text = RETRIEVAL_FUNCTIONS.get_constraints!.render([
      { label: 'left knee', plan_around: true },
      { area: 'shoulder', condition: 'sore', plan_around: false },
    ]);
    expect(text).toBe('What we work around: left knee [plan-around]; shoulder — sore');
  });

  it('get_equipment includes wear when present', () => {
    expect(RETRIEVAL_FUNCTIONS.get_equipment!.render([])).toBe('');
    expect(
      RETRIEVAL_FUNCTIONS.get_equipment!.render([
        { name: 'Pegasus', wear: { accumulated_km: 120, threshold_km: 500, status: 'ok' } },
      ]),
    ).toBe('Equipment: Pegasus (120/500km ok)');
  });

  /**
   * Body facts, in the user's own unit, with height and age beside them (2026-08-22). It printed
   * `kg` unconditionally and carried weight alone, so a user who gave pounds was answered in kilos
   * and asked for his height and age he had already given.
   */
  it('get_weight omits without current', () => {
    expect(RETRIEVAL_FUNCTIONS.get_weight!.render(null)).toBe('');
    expect(RETRIEVAL_FUNCTIONS.get_weight!.render({ current: null, height_cm: null, age: null })).toBe('');
  });

  it('get_weight renders body facts in the stored unit', () => {
    expect(RETRIEVAL_FUNCTIONS.get_weight!.render({ current: 82.5, start: 90, unit: 'kg' })).toBe(
      'Weight: 82.5kg (start 90kg)',
    );
    expect(
      RETRIEVAL_FUNCTIONS.get_weight!.render({ current: 88.5, start: null, unit: 'lb', height_cm: 178, age: 41 }),
    ).toBe('Weight: 195.1lb · Height: 178cm · Age: 41');
  });

  const dietary = (profile: Record<string, unknown>, eating_window: unknown = null) => ({ profile, eating_window });

  it('get_dietary_profile renders allergies and empty state', () => {
    expect(
      RETRIEVAL_FUNCTIONS.get_dietary_profile!.render(
        dietary({ allergies: [], diet: null, dislikes: [], notes: null }),
      ),
    ).toMatch(/none set yet/);
    expect(
      RETRIEVAL_FUNCTIONS.get_dietary_profile!.render(
        dietary({ allergies: ['peanuts'], diet: 'vegan', dislikes: ['cilantro'], notes: null }),
      ),
    ).toMatch(/peanuts/);
    expect(
      RETRIEVAL_FUNCTIONS.get_dietary_profile!.rows(
        dietary({ allergies: ['peanuts'], diet: 'vegan', dislikes: [], notes: null }),
      ),
    ).toBe(2);
  });

  // The window is stored on the baseline (the planner reads it there) but the COACH only ever sees
  // what the pack renders — availability is stored faithfully and rendered nowhere, and this is the
  // hole that reproduces. It rides here because this is the moment she is about to offer breakfast.
  it('get_dietary_profile carries the eating window, and stays silent without one', () => {
    const empty = dietary({ allergies: [], diet: null, dislikes: [], notes: null });
    expect(RETRIEVAL_FUNCTIONS.get_dietary_profile!.render(empty)).not.toMatch(/Eating window/);

    const fasting = dietary(
      { allergies: ['peanuts'], diet: null, dislikes: [], notes: null },
      { said_as: '16:8', windows: [{ earliest: '12:00', latest: '20:00' }] },
    );
    const text = RETRIEVAL_FUNCTIONS.get_dietary_profile!.render(fasting);
    expect(text).toMatch(/peanuts/); // the safety half is untouched
    expect(text).toMatch(/Eating window — their words: "16:8"; eats 12:00–20:00\./);
    // A window is one more fact the pack is carrying, so provenance counts it.
    expect(RETRIEVAL_FUNCTIONS.get_dietary_profile!.rows(fasting)).toBe(2);
  });

  it('get_dietary_profile catalog description mentions meal timing so context_select pulls it', () => {
    expect(RETRIEVAL_FUNCTIONS.get_dietary_profile!.description).toMatch(/timing/);
  });

  it('get_food_log empty vs recent meals', () => {
    expect(
      RETRIEVAL_FUNCTIONS.get_food_log!.render({
        meals: [],
        summary: {
          window_days: 7,
          days_logged: 0,
          meals_logged: 0,
          meals_per_logged_day: 0,
          top_items: [],
          alcohol_days: 0,
          caffeine_days: 0,
        },
      }),
    ).toBe('Food log: nothing logged in the last 7 days.');
    const meals = [
      {
        date: '2026-07-18',
        meal: 'lunch',
        items: [{ name: 'salad' }],
        raw_text: null,
      },
    ];
    const summary = {
      window_days: 7,
      days_logged: 1,
      meals_logged: 1,
      meals_per_logged_day: 1,
      top_items: [{ name: 'salad', count: 1 }],
      alcohol_days: 0,
      caffeine_days: 0,
    };
    const text = RETRIEVAL_FUNCTIONS.get_food_log!.render({ meals, summary });
    expect(text).toContain('salad');
    expect(text).toContain('2026-07-18 lunch');
  });

  it('get_workout_history lists sessions newest first, omitting absent measures', () => {
    const r = {
      days: 30,
      workouts: [
        {
          source: 'healthkit',
          type: 'running',
          startedAt: '2026-08-14T07:10:00Z',
          durationMin: 31,
          distanceKm: 5.2,
          avgHr: 148,
        },
        {
          source: 'healthkit',
          type: 'strength training',
          startedAt: '2026-08-12T18:00:00Z',
          durationMin: 45,
          distanceKm: null,
          avgHr: null,
        },
      ],
    };
    expect(RETRIEVAL_FUNCTIONS.get_workout_history!.render(r)).toBe(
      'Recorded workouts (last 30d, newest first):\n' +
        '- 2026-08-14 · running · 31 min · 5.2 km · avg 148 bpm\n' +
        '- 2026-08-12 · strength training · 45 min',
    );
    expect(RETRIEVAL_FUNCTIONS.get_workout_history!.render({ days: 30, workouts: [] })).toBe('');
    expect(RETRIEVAL_FUNCTIONS.get_workout_history!.rows(r)).toBe(2);
  });

  /**
   * The shape the DATABASE really returns, which is not the shape the row type claims.
   *
   * `postgres.js` hands back `timestamptz` as a Date; `WorkoutHistoryRow.startedAt` is typed
   * `string` on a hand-written query generic, so nothing ever objected — and the test above fed
   * it a string, so the suite agreed. In production `.slice()` threw on every row, the coach tool
   * path turned the throw into "(nothing on file for this yet)", and she told a user with thirty
   * recorded workouts that there was nothing there (2026-08-16).
   *
   * So the fixture here is deliberately a Date. A test that only ever feeds the declared type can
   * only ever prove the declaration is self-consistent.
   */
  it('renders rows exactly as postgres returns them — Date timestamps, not strings', () => {
    const r = {
      days: 30,
      workouts: [
        {
          source: 'healthkit',
          type: 'running',
          startedAt: new Date('2026-08-15T10:57:00Z') as unknown as string,
          durationMin: 77,
          distanceKm: 8.78,
          avgHr: null,
        },
      ],
    };
    expect(RETRIEVAL_FUNCTIONS.get_workout_history!.render(r)).toBe(
      'Recorded workouts (last 30d, newest first):\n- 2026-08-15 · running · 77 min · 8.78 km',
    );
  });

  it('get_journal survives the same Date-shaped created_at', () => {
    const entries = [{ created_at: new Date('2026-08-14T20:00:00Z'), prompt: null, body: 'A quiet one.' }];
    expect(RETRIEVAL_FUNCTIONS.get_journal!.render(entries)).toContain('2026-08-14');
  });

  it('get_recent_logs formats felt notes', () => {
    const rows = [
      {
        date: '2026-07-17',
        title: 'Easy run',
        log: { summary: '5k easy', items: [{ felt: 'good' }] },
      },
    ];
    const text = RETRIEVAL_FUNCTIONS.get_recent_logs!.render(rows);
    expect(text).toContain('- 2026-07-17 · Easy run: 5k easy (felt good)');
  });

  /**
   * The block is PREFETCHED into the pack, so it arrives without the tool description that says
   * these are the user's own write-ups and points at `get_workout_history` for the device record.
   * Measured 2026-08-29: asked for "the actual longest" run, she answered 11.4 km — the longest he
   * had written up — in 3 of 4 samples, calling nothing, while his watch held an unlogged 13.2 km.
   * Confident and wrong by 1.8 km, off a block that looked complete and never said it wasn't.
   */
  it('get_recent_logs says what it is NOT, because it is prefetched without its description', () => {
    const text = RETRIEVAL_FUNCTIONS.get_recent_logs!.render([
      { date: '2026-07-17', title: 'Long run', log: { summary: '11.4 km in 77 minutes', items: [] } },
    ]);
    expect(text).toMatch(/NOT a complete record/i);
    expect(text).toContain('get_workout_history');
    expect(text).toMatch(/never answer "how far"/i);
  });

  it('lookup_food renders cache/USDA hits with micros when present', () => {
    expect(RETRIEVAL_FUNCTIONS.lookup_food!.render({ q: '', foods: [] })).toMatch(/pass q/);
    expect(RETRIEVAL_FUNCTIONS.lookup_food!.render({ q: 'oats', foods: [] })).toMatch(/no matches/);
    const text = RETRIEVAL_FUNCTIONS.lookup_food!.render({
      q: 'oats',
      foods: [
        {
          food_id: 'f1',
          name: 'Oats',
          brand: null,
          source: 'usda',
          base_unit: 'g',
          macros_per_base: { kcal: 389, protein_g: 17, zinc_mg: 4 },
        },
      ],
    });
    expect(text).toContain('Food lookup "oats"');
    expect(text).toContain('Oats');
    expect(text).toContain('[usda]');
    expect(text).toContain('Zn 4mg');
    expect(RETRIEVAL_FUNCTIONS.lookup_food!.rows({ q: 'oats', foods: [{ food_id: 'f1' }] })).toBe(1);
  });

  it('lookup_food run delegates to searchFoodsWithUsda', async () => {
    vi.mocked(searchFoodsWithUsda).mockResolvedValue([
      {
        food_id: 'f1',
        owner_user_id: null,
        visibility: 'shared',
        name: 'Chickpeas',
        brand: null,
        source: 'usda',
        off_id: null,
        fdc_id: 1,
        base_unit: 'g',
        macros_per_base: { kcal: 164, zinc_mg: 1.5 },
        servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
        default_serving: 0,
        confidence: 1,
        photo_ref: null,
      },
    ]);
    const result = (await RETRIEVAL_FUNCTIONS.lookup_food!.run('user-1', { q: 'chickpeas', limit: 3 })) as {
      q: string;
      foods: unknown[];
    };
    expect(result.q).toBe('chickpeas');
    expect(result.foods).toHaveLength(1);
    expect(searchFoodsWithUsda).toHaveBeenCalledWith('user-1', 'chickpeas', 3);
  });
});
