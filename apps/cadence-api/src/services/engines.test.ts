import { describe, it, expect } from 'vitest';
import type { Goal, EquipmentWear } from '@cadence/shared';
import { evaluateGuardrail, goalLoad } from './goal-guardrail.ts';
import { budgetTier } from './token-budget.ts';
import { parseRecurrence, expandRecurrence, describeRecurrence } from './scheduling.ts';
import { wearStatus, applyRun } from './shoe-mileage.ts';
import { detectTripwires, haversineKm } from './tripwires.ts';
import { selectCapturedGoals, normalizeBaseline, normTitle } from './capture-normalize.ts';
import { matchGoal } from './plan-match.ts';
import { startingPointGaps } from './intake.ts';
import { summarizeNutrition, renderNutritionLine } from './nutrition-summarize.ts';
import { parsePhotoDataUrl, MAX_PHOTO_BYTES } from './photo-validate.ts';

type GoalLite = Pick<Goal, 'area' | 'type' | 'status'>;

describe('goal-guardrail (§6.2/§A1)', () => {
  it('weights contemplative areas cheaper than training blocks', () => {
    expect(goalLoad({ area: 'practice', type: 'recurring' })).toBe(1);
    expect(goalLoad({ area: 'mind', type: 'milestone' })).toBe(1);
    expect(goalLoad({ area: 'nourishment', type: 'recurring' })).toBe(2);
    expect(goalLoad({ area: 'movement', type: 'milestone' })).toBe(3);
  });

  it('trips the focus budget on weighted load, not raw count', () => {
    const practices: GoalLite[] = Array.from({ length: 7 }, () => ({
      area: 'practice',
      type: 'recurring',
      status: 'confirmed',
    }));
    const v = evaluateGuardrail(practices); // 7 practices → load 7 > budget 6
    expect(v.activeCount).toBe(7);
    expect(v.weightedLoad).toBe(7);
    expect(v.overFocusBudget).toBe(true);
    expect(v.exceedsHardCap).toBe(false);
  });

  it('lets a healthy mixed starting set through (race + two gentle habits)', () => {
    const set: GoalLite[] = [
      { area: 'movement', type: 'target', status: 'confirmed' }, // 3
      { area: 'mind', type: 'recurring', status: 'confirmed' }, // 1
      { area: 'practice', type: 'recurring', status: 'confirmed' }, // 1
    ];
    const v = evaluateGuardrail(set); // load 5 ≤ budget 6
    expect(v.weightedLoad).toBe(5);
    expect(v.overFocusBudget).toBe(false);
  });

  it('excludes parked/completed goals from active count', () => {
    const goals: GoalLite[] = [
      { area: 'movement', type: 'milestone', status: 'parked' },
      { area: 'movement', type: 'milestone', status: 'completed' },
    ];
    expect(evaluateGuardrail(goals).activeCount).toBe(0);
  });
});

describe('token-budget (§4.3)', () => {
  it('maps usage ratio to green/amber/red', () => {
    expect(budgetTier(10, 100)).toBe('green');
    expect(budgetTier(70, 100)).toBe('amber');
    expect(budgetTier(90, 100)).toBe('red');
  });
});

describe('scheduling (§5.4)', () => {
  it('parses FREQ=WEEKLY;BYDAY=MO,WE,FR', () => {
    const p = parseRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(p.freq).toBe('WEEKLY');
    expect(p.byday).toEqual([1, 3, 5]);
  });

  it('expands weekly BYDAY over a range (2026-06-29 is a Monday)', () => {
    const dates = expandRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-06-29', '2026-07-05');
    expect(dates).toEqual(['2026-06-29', '2026-07-01', '2026-07-03']);
  });

  it('expands daily inclusively', () => {
    expect(expandRecurrence('FREQ=DAILY', '2026-06-29', '2026-07-01')).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
    ]);
  });

  it('every other day fires on alternating dates from the anchor', () => {
    expect(expandRecurrence('FREQ=DAILY;INTERVAL=2', '2026-06-29', '2026-07-05', '2026-06-29')).toEqual([
      '2026-06-29',
      '2026-07-01',
      '2026-07-03',
      '2026-07-05',
    ]);
  });

  it('every-other-day parity stays STABLE when the horizon is topped up later', () => {
    // Same anchor (06-29), but a later rolling window [07-06..07-10] — must keep the same parity.
    expect(expandRecurrence('FREQ=DAILY;INTERVAL=2', '2026-07-06', '2026-07-10', '2026-06-29')).toEqual([
      '2026-07-07',
      '2026-07-09',
    ]);
  });

  it('every other week fires on the weekday in alternating weeks', () => {
    expect(expandRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-06-29', '2026-07-27', '2026-06-29')).toEqual([
      '2026-06-29',
      '2026-07-13',
      '2026-07-27',
    ]);
  });

  it('monthly fires on BYMONTHDAY dates', () => {
    expect(expandRecurrence('FREQ=MONTHLY;BYMONTHDAY=1,15', '2026-07-01', '2026-08-31', '2026-06-29')).toEqual([
      '2026-07-01',
      '2026-07-15',
      '2026-08-01',
      '2026-08-15',
    ]);
  });

  it('bare weekly fires only on the anchor weekday (not every day)', () => {
    // 2026-06-29 is a Monday → weekly with no BYDAY means Mondays only.
    expect(expandRecurrence('FREQ=WEEKLY', '2026-06-29', '2026-07-05', '2026-06-29')).toEqual(['2026-06-29']);
  });

  it('describes cadences for the UI', () => {
    expect(describeRecurrence('FREQ=DAILY;INTERVAL=2')).toBe('Every other day');
    expect(describeRecurrence('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('Mon, Wed, Fri');
    expect(describeRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO')).toBe('Every other week · Mon');
    expect(describeRecurrence('FREQ=MONTHLY;BYMONTHDAY=1,15')).toBe('Monthly · days 1, 15');
    expect(describeRecurrence('FREQ=DAILY')).toBe('Every day');
  });
});

describe('shoe-mileage (§5.3)', () => {
  it('flags retire_soon past ~85% and retired at threshold', () => {
    expect(wearStatus(500, 600)).toBe('active');
    expect(wearStatus(540, 600)).toBe('retire_soon');
    expect(wearStatus(600, 600)).toBe('retired');
  });

  it('accumulates a run onto the active shoe', () => {
    const wear: EquipmentWear = {
      tracks_mileage: true,
      accumulated_km: 412,
      threshold_km: 600,
      auto_sum_from: 'healthkit_runs',
      status: 'active',
    };
    const next = applyRun(wear, 5.2);
    expect(next.accumulated_km).toBe(417.2);
    expect(next.status).toBe('active');
  });
});

describe('tripwires (§B4)', () => {
  it('returns [] when nothing trips (no Broker call needed)', () => {
    expect(detectTripwires({})).toEqual([]);
  });

  it('detects timezone shift + consistency/outcome divergence', () => {
    const fired = detectTripwires({
      homeTimezoneOffsetMin: 0,
      currentTimezoneOffsetMin: 360,
      consistencyRate: 0.9,
      outcomeDelta: 0,
    });
    expect(fired).toContain('timezone_shift');
    expect(fired).toContain('consistency_outcome_divergence');
  });

  it('haversine approximates a known distance (NYC→LA ≈ 3936 km)', () => {
    const km = haversineKm(40.71, -74.01, 34.05, -118.24);
    expect(km).toBeGreaterThan(3800);
    expect(km).toBeLessThan(4100);
  });
});

describe('capture selectCapturedGoals (§6.1 — no duplicate goal cards)', () => {
  const titles = (gs: { title?: string }[]) => gs.map((g) => g.title);

  it('collapses intra-run near-duplicates to one, keeping the first seen', () => {
    const kept = selectCapturedGoals(
      [{ title: 'Run a 10k' }, { title: 'Run a 10k this spring' }],
      new Set(),
      [],
    );
    expect(titles(kept)).toEqual(['Run a 10k']);
  });

  it('keeps genuinely distinct goals that merely share a word', () => {
    const kept = selectCapturedGoals(
      [{ title: 'Run a 10k' }, { title: 'Run a marathon' }],
      new Set(),
      [],
    );
    expect(titles(kept)).toEqual(['Run a 10k', 'Run a marathon']);
  });

  it('drops an EXACT match of a confirmed/committed goal, but not a mere superstring', () => {
    const confirmed = new Set([normTitle('Run a 10k')]);
    // exact-confirmed dropped; the distinct new goal kept
    expect(titles(selectCapturedGoals([{ title: 'Run a 10k' }, { title: 'Meditate daily' }], confirmed, []))).toEqual(
      ['Meditate daily'],
    );
    // a superstring of a confirmed goal is a NEW, more specific goal — confirmed match is exact-only
    expect(titles(selectCapturedGoals([{ title: 'Run a 10k this spring' }], confirmed, []))).toEqual([
      'Run a 10k this spring',
    ]);
  });

  it('fuzzy-skips a re-extraction of a milestone-bearing "sticky" captured goal', () => {
    const sticky = [normTitle('Run a 10k')];
    expect(selectCapturedGoals([{ title: 'Run a 10k this spring' }], new Set(), sticky)).toHaveLength(0);
  });

  it('drops empty/whitespace titles', () => {
    const kept = selectCapturedGoals([{ title: '' }, { title: '   ' }, { title: 'Read more' }], new Set(), []);
    expect(titles(kept)).toEqual(['Read more']);
  });
});

describe('capture normalizeBaseline (§6.1 — weight lands where the UI reads it)', () => {
  it('canonicalizes {value, unit:lbs} to weight_kg{current,start} + weight_unit', () => {
    const b = normalizeBaseline({ weight: { value: 200, unit: 'lbs' } });
    const w = b.weight_kg as { current: number; start: number; source: string };
    expect(w.current).toBe(90.7); // 200 * 0.453592, rounded to 0.1
    expect(w.start).toBe(90.7);
    expect(w.source).toBe('captured');
    expect(b.weight_unit).toBe('lbs');
  });

  it('accepts a bare kg number and the legacy weight_lbs key', () => {
    expect((normalizeBaseline({ weight_kg: 80 }).weight_kg as { current: number }).current).toBe(80);
    expect(normalizeBaseline({ weight_kg: 80 }).weight_unit).toBe('kg');
    expect((normalizeBaseline({ weight_lbs: 150 }).weight_kg as { current: number }).current).toBe(68);
    expect(normalizeBaseline({ weight_lbs: 150 }).weight_unit).toBe('lbs');
  });

  it('passes through age/height and omits weight when none is stated', () => {
    const b = normalizeBaseline({ age: 30, height_cm: 180 });
    expect(b.age).toBe(30);
    expect(b.height_cm).toBe(180);
    expect(b.weight_kg).toBeUndefined();
  });

  it('maps constraints and legacy injuries into the unified constraint list', () => {
    const c = normalizeBaseline({ constraints: [{ label: 'burnout', kind: 'life', plan_around: true }] })
      .constraints as Array<{ label: string; kind: string; plan_around: boolean; id: string }>;
    expect(c).toHaveLength(1);
    const c0 = c[0]!;
    expect(c0).toMatchObject({ label: 'burnout', kind: 'life', plan_around: true });
    expect(typeof c0.id).toBe('string');

    const inj = normalizeBaseline({ injuries: [{ area: 'left knee', condition: 'patellar tendinopathy' }] })
      .constraints as Array<{ label: string; kind: string; plan_around: boolean }>;
    expect(inj[0]!).toMatchObject({ label: 'left knee — patellar tendinopathy', kind: 'physical', plan_around: true });
  });
});

describe('plan matchGoal (§6.3 — commitments link to their objective)', () => {
  const goals = [
    { goal_id: 'g1', title: 'Run a 10k' },
    { goal_id: 'g2', title: 'Read 100 books' },
  ] as unknown as Goal[];

  it('matches an exact (case/space-insensitive) title to its goal', () => {
    expect(matchGoal('Run a 10k', goals)?.goal_id).toBe('g1');
    expect(matchGoal('read 100 BOOKS', goals)?.goal_id).toBe('g2');
  });

  it('matches a lightly reworded title via UNIQUE containment', () => {
    expect(matchGoal('Run a 10k this spring', goals)?.goal_id).toBe('g1');
  });

  it('returns the canonical goal title, not the model echo', () => {
    expect(matchGoal('run a 10k', goals)?.title).toBe('Run a 10k');
  });

  it('returns undefined for empty, no-match, or foundational/system activities', () => {
    expect(matchGoal(undefined, goals)).toBeUndefined();
    expect(matchGoal('', goals)).toBeUndefined();
    expect(matchGoal('Weekly check-in', goals)).toBeUndefined();
  });

  it('refuses an AMBIGUOUS containment match rather than mis-linking', () => {
    const ambiguous = [
      { goal_id: 'a', title: 'Read books' },
      { goal_id: 'b', title: 'Read papers' },
    ] as unknown as Goal[];
    expect(matchGoal('Read', ambiguous)).toBeUndefined(); // "read" ⊂ both → unlinked, never guessed
  });
});

describe('intake startingPointGaps (dynamic intake — "where are you now?")', () => {
  type G = Parameters<typeof startingPointGaps>[0][number];
  const g = (over: Partial<G>): G =>
    ({ title: 'Run a faster 5k', type: 'target', measure: { metric: '5k time', target: 30, unit: 'min' }, ...over }) as G;

  it('flags a target goal with a target but no start', () => {
    expect(startingPointGaps([g({})])).toEqual([{ title: 'Run a faster 5k', metric: '5k time' }]);
  });

  it('clears once a start is known (intake question answered)', () => {
    expect(startingPointGaps([g({ measure: { metric: '5k time', target: 30, start: 35, unit: 'min' } })])).toEqual([]);
  });

  it('skips milestone/recurring goals and goals with no numeric target', () => {
    expect(startingPointGaps([g({ type: 'milestone' }), g({ type: 'recurring' })])).toEqual([]);
    expect(startingPointGaps([g({ measure: { metric: 'pages', target: '' } as G['measure'] })])).toEqual([]);
  });

  it('skips body-weight metrics — baseline owns the current weight', () => {
    expect(startingPointGaps([g({ measure: { metric: 'body weight', target: 175, unit: 'lbs' } })])).toEqual([]);
    expect(startingPointGaps([g({ measure: { metric: 'weight', target: 80, unit: 'kg' } })])).toEqual([]);
  });

  it('caps at 3 so the readiness line never floods', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((t) => g({ title: t }));
    expect(startingPointGaps(many)).toHaveLength(3);
  });
});

describe('nutrition summarize (Observe phase — §5.6 module arc)', () => {
  type Row = Parameters<typeof summarizeNutrition>[0][number];
  const row = (over: Partial<Row>): Row =>
    ({ date: '2026-07-16', meal: 'breakfast', items: [{ name: 'eggs' }], flags: {}, ...over }) as Row;

  it('counts distinct days (the phase signal), meals, and meals/day', () => {
    const s = summarizeNutrition(
      [
        row({ date: '2026-07-14' }),
        row({ date: '2026-07-14', meal: 'dinner', items: [{ name: 'salmon' }] }),
        row({ date: '2026-07-15', items: [{ name: 'eggs' }, { name: 'toast' }] }),
      ],
      7,
    );
    expect(s.days_logged).toBe(2);
    expect(s.meals_logged).toBe(3);
    expect(s.meals_per_logged_day).toBe(1.5);
  });

  it('ranks top items case-insensitively and caps at 5', () => {
    const rows = [
      row({ items: [{ name: 'Eggs' }, { name: 'coffee' }] }),
      row({ date: '2026-07-15', items: [{ name: 'eggs' }, { name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }),
    ];
    const s = summarizeNutrition(rows, 7);
    expect(s.top_items[0]).toEqual({ name: 'eggs', count: 2 });
    expect(s.top_items).toHaveLength(5);
  });

  it('counts alcohol/caffeine by DAY, not by mention', () => {
    const s = summarizeNutrition(
      [
        row({ date: '2026-07-14', flags: { alcohol: true } }),
        row({ date: '2026-07-14', meal: 'drink', flags: { alcohol: true, caffeine: true } }),
        row({ date: '2026-07-15', flags: {} }),
      ],
      7,
    );
    expect(s.alcohol_days).toBe(1);
    expect(s.caffeine_days).toBe(1);
  });

  it('renders one compact line, and nothing when empty', () => {
    expect(renderNutritionLine(summarizeNutrition([], 7))).toBe('');
    const line = renderNutritionLine(summarizeNutrition([row({ flags: { alcohol: true } })], 7));
    expect(line).toContain('1 of last 7 days logged');
    expect(line).toContain('alcohol on 1 day');
  });
});

describe('photo-validate (meal photos — capture-first)', () => {
  const jpeg = (bytes: number) => `data:image/jpeg;base64,${Buffer.alloc(bytes, 1).toString('base64')}`;

  it('accepts jpeg/png/webp data URLs and reports mime + extension', () => {
    const r = parsePhotoDataUrl(jpeg(100));
    expect(r.ok && r.mime === 'image/jpeg' && r.ext === 'jpg' && r.buffer.length === 100).toBe(true);
    expect(parsePhotoDataUrl(`data:image/png;base64,${Buffer.alloc(8, 1).toString('base64')}`).ok).toBe(true);
    expect(parsePhotoDataUrl(`data:image/webp;base64,${Buffer.alloc(8, 1).toString('base64')}`).ok).toBe(true);
  });

  it('rejects non-image payloads, junk, and svg (never trusted)', () => {
    for (const bad of ['data:text/plain;base64,aGk=', 'data:image/svg+xml;base64,aGk=', 'not a data url', 'data:image/jpeg;base64,!!!']) {
      expect(parsePhotoDataUrl(bad).ok).toBe(false);
    }
  });

  it('caps decoded size at MAX_PHOTO_BYTES', () => {
    const over = parsePhotoDataUrl(jpeg(MAX_PHOTO_BYTES + 1));
    expect(!over.ok && over.reason === 'too_large').toBe(true);
    expect(parsePhotoDataUrl(jpeg(MAX_PHOTO_BYTES)).ok).toBe(true);
  });
});
