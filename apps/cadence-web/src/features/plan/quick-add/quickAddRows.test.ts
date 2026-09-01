/**
 * The quick-add derivation's two rules (owner, 2026-09-01), pinned:
 *
 *   1. Only what's already tracked — no signal, no row. An absent field (older server, failed
 *      read) is a no-claim: the row stays away, it is never invented.
 *   2. Nothing the plan already gives a button for — the sheet never lists plan activities, and
 *      the weight row stands down on a day whose trail carries its own weigh-in.
 */
import { describe, it, expect } from 'vitest';
import { deriveQuickAddRows, type QuickAddRow } from './quickAddRows.ts';
import type { NutritionDayData, PlanActivity, PlanDay, PlanViewData } from '../../../lib/api.ts';

const activity = (over: Partial<PlanActivity> = {}): PlanActivity => ({
  activity_id: 'a1',
  title: 'Easy run',
  kind: 'user',
  cadence: 'weekly',
  recurrence: '',
  ...over,
});

const day = (over: Partial<PlanDay> = {}): PlanDay => ({
  date: '2026-09-01',
  weekday: 'Tue',
  dayNum: 1,
  isToday: true,
  occurrences: [],
  ...over,
});

const plan = (over: Partial<PlanViewData> = {}): PlanViewData => ({
  hasPlan: true,
  stage: 'committed',
  activities: [],
  week: [],
  consistency: { kept: 0, window: 7 },
  ...over,
});

const nutrition = (over: Partial<NutritionDayData> = {}): NutritionDayData =>
  ({ date: '2026-09-01', meals: [], ...over }) as NutritionDayData;

const kinds = (rows: QuickAddRow[]) => rows.map((r) => r.kind);

describe('deriveQuickAddRows', () => {
  it('offers nothing at all from nothing — no signal, no row', () => {
    expect(deriveQuickAddRows({ plan: null, day: null, photosEnabled: false })).toEqual([]);
    // An older server's day without the gate fields is a no-claim, not a hint.
    expect(deriveQuickAddRows({ plan: plan(), day: nutrition(), photosEnabled: false })).toEqual([]);
  });

  it('water and meal rows follow their trailing-window gates', () => {
    const rows = deriveQuickAddRows({
      plan: null,
      day: nutrition({ has_recent_water: true, has_recent_food: true }),
      photosEnabled: false,
    });
    expect(kinds(rows)).toEqual(['water', 'meal']);
  });

  it('never turns plan activities into per-activity rows — areas only', () => {
    const p = plan({
      activities: [
        activity({ activity_id: 'a1', title: 'Easy run', area: 'movement', goal_title: 'Run a 10k' }),
        activity({ activity_id: 'a2', title: 'Strength', area: 'movement', goal_title: 'Run a 10k' }),
        activity({ activity_id: 'a3', title: 'Piano practice', area: 'practice', goal_title: 'Learn piano' }),
      ],
    });
    const rows = deriveQuickAddRows({ plan: p, day: null, photosEnabled: false });
    // Two distinct movement titles → nothing to single out, the area keeps its generic noun.
    // One distinct practice title → the noun is the activity's own name, suffix stripped.
    expect(rows).toEqual([
      { kind: 'add', area: 'movement', toward: 'Run a 10k', noun: 'A workout' },
      { kind: 'add', area: 'practice', toward: 'Learn piano', noun: 'Piano' },
    ]);
  });

  it('drops the toward line when an area feeds more than one goal', () => {
    const p = plan({
      activities: [
        activity({ activity_id: 'a1', area: 'movement', goal_title: 'Run a 10k' }),
        activity({ activity_id: 'a2', area: 'movement', goal_title: 'Get stronger' }),
      ],
    });
    // Both activities share the factory's default title ('Easy run'), which maps to the same
    // TYPE noun either way — the toward line drops, the noun still resolves.
    expect(deriveQuickAddRows({ plan: p, day: null, photosEnabled: false })).toEqual([
      { kind: 'add', area: 'movement', toward: undefined, noun: 'A run' },
    ]);
  });

  describe('the noun a movement/practice row wears', () => {
    const rowFor = (area: 'movement' | 'practice', titles: string[]) =>
      deriveQuickAddRows({
        plan: plan({ activities: titles.map((title, i) => activity({ activity_id: `a${i}`, area, title })) }),
        day: null,
        photosEnabled: false,
      })[0];

    describe('practice — the title itself is the noun', () => {
      it('strips a generic trailing word off a single distinctive title', () => {
        expect(rowFor('practice', ['Piano practice'])).toEqual({
          kind: 'add',
          area: 'practice',
          toward: undefined,
          noun: 'Piano',
        });
        // Repeated suffixes strip one at a time, so a doubled-up title still lands on the name.
        expect(rowFor('practice', ['Evening practice session'])).toMatchObject({ noun: 'Evening' });
      });

      it('falls back to the area floor when the title IS the generic word', () => {
        expect(rowFor('practice', ['Practice'])).toMatchObject({ noun: 'A practice' });
      });

      it('falls back to the area floor when more than one distinct title is in play', () => {
        expect(rowFor('practice', ['Piano practice', 'Guitar practice'])).toMatchObject({ noun: 'A practice' });
      });
    });

    // Code review, 2026-09-01: a movement title is a task NAME that already sits on the trail
    // with its own button — showing it verbatim here would be a second, differently-behaving row
    // wearing the plan's own name. The noun must be the TYPE of the thing, never the task's title.
    describe('movement — the TYPE of the thing is the noun, never the task’s own name', () => {
      it('never shows a movement activity’s own title — a lone "Easy run" yields "A run"', () => {
        const row = rowFor('movement', ['Easy run']);
        expect(row).toMatchObject({ noun: 'A run' });
        expect(row).not.toMatchObject({ noun: 'Easy run' });
      });

      it('maps each word family to its own type noun, and anything unrecognised to the floor', () => {
        expect(rowFor('movement', ['Morning walk'])).toMatchObject({ noun: 'A walk' });
        expect(rowFor('movement', ['Evening ride'])).toMatchObject({ noun: 'A ride' });
        expect(rowFor('movement', ['Lap swim'])).toMatchObject({ noun: 'A swim' });
        expect(rowFor('movement', ['Erg row'])).toMatchObject({ noun: 'A row' });
        expect(rowFor('movement', ['Strength day'])).toMatchObject({ noun: 'A workout' });
        expect(rowFor('movement', ['Hotel HIIT'])).toMatchObject({ noun: 'A workout' });
      });

      it('keeps the type noun when differently-titled activities share one type', () => {
        expect(rowFor('movement', ['Easy run', 'Speed run'])).toMatchObject({ noun: 'A run' });
      });

      it('falls back to the area floor when more than one distinct TYPE is in play', () => {
        expect(rowFor('movement', ['Easy run', 'Strength day'])).toMatchObject({ noun: 'A workout' });
        expect(rowFor('movement', ['Session'])).toMatchObject({ noun: 'A workout' });
      });
    });
  });

  it('ignores system rows and untracked areas when deriving the add rows', () => {
    const p = plan({
      activities: [
        activity({ kind: 'system', title: 'Weekly weigh-in' }),
        activity({ activity_id: 'a2', area: 'mind', title: 'Evening wind-down' }),
      ],
    });
    // The weigh-in yields a weight row, not an add row; a mind activity yields neither.
    expect(kinds(deriveQuickAddRows({ plan: p, day: null, photosEnabled: false }))).toEqual(['weight']);
  });

  it('offers the weight row only for a plan that tracks weight', () => {
    expect(kinds(deriveQuickAddRows({ plan: plan(), day: null, photosEnabled: false }))).toEqual([]);
    const p = plan({ activities: [activity({ kind: 'system', title: 'Weekly weigh-in' })] });
    expect(kinds(deriveQuickAddRows({ plan: p, day: null, photosEnabled: false }))).toEqual(['weight']);
  });

  it('stands the weight row down on a day the trail carries its own weigh-in', () => {
    const weighToday = (status: 'pending' | 'done') =>
      plan({
        activities: [activity({ kind: 'system', title: 'Weekly weigh-in' })],
        week: [
          day({
            occurrences: [{ occurrence_id: 'o1', activity_id: 'a1', title: 'Weekly weigh-in', kind: 'system', status }],
          }),
        ],
      });
    // Pending → the trail's button owns it; done → today's number already exists. Both stand down.
    expect(kinds(deriveQuickAddRows({ plan: weighToday('pending'), day: null, photosEnabled: false }))).toEqual([]);
    expect(kinds(deriveQuickAddRows({ plan: weighToday('done'), day: null, photosEnabled: false }))).toEqual([]);
  });

  it('keeps the weight row when the weigh-in sits on another day', () => {
    const p = plan({
      activities: [activity({ kind: 'system', title: 'Weekly weigh-in' })],
      week: [
        day({
          isToday: false,
          occurrences: [
            { occurrence_id: 'o1', activity_id: 'a1', title: 'Weekly weigh-in', kind: 'system', status: 'pending' },
          ],
        }),
        day({ isToday: true }),
      ],
    });
    expect(kinds(deriveQuickAddRows({ plan: p, day: null, photosEnabled: false }))).toEqual(['weight']);
  });

  it('offers the photo row only behind the opt-in', () => {
    expect(kinds(deriveQuickAddRows({ plan: null, day: null, photosEnabled: true }))).toEqual(['photo']);
  });

  it('keeps a stable order: water, meal, weight, adds, photo', () => {
    const rows = deriveQuickAddRows({
      plan: plan({
        activities: [
          activity({ kind: 'system', title: 'Weekly weigh-in' }),
          activity({ activity_id: 'a2', area: 'movement' }),
          activity({ activity_id: 'a3', area: 'practice' }),
        ],
      }),
      day: nutrition({ has_recent_water: true, has_recent_food: true }),
      photosEnabled: true,
    });
    expect(kinds(rows)).toEqual(['water', 'meal', 'weight', 'add', 'add', 'photo']);
  });
});
