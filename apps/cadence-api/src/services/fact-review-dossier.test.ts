/**
 * The fact list the weekly review reads (fact-review-dossier.ts): what goes in, what is left out on
 * purpose, the run-local ids, and the line each fact renders as.
 */
import { describe, it, expect } from 'vitest';
import type { Constraint, Equipment, Goal } from '@cadence/shared';
import {
  buildReviewDossier,
  dayOf,
  renderDossier,
  renderFact,
  shiftDay,
  type DossierSources,
} from './fact-review-dossier.ts';

const eq = (name: string, over: Partial<Equipment> & { created_at?: unknown } = {}) =>
  ({
    equipment_id: name,
    name,
    category: 'strength',
    owned: true,
    recommended_by: null,
    linked_goal_ids: [],
    ...over,
  }) as Equipment & {
    created_at?: unknown;
  };
const goal = (title: string, over: Partial<Goal> & { created_at?: unknown } = {}) =>
  ({
    goal_id: title,
    title,
    area: 'movement',
    type: 'milestone',
    measure: {},
    timeframe: {},
    status: 'confirmed',
    linked_equipment: [],
    source: 'captured',
    ...over,
  }) as unknown as Goal & { created_at?: unknown };
const con = (label: string, over: Partial<Constraint> = {}): Constraint => ({
  id: label,
  label,
  plan_around: true,
  ...over,
});

const empty: DossierSources = {
  constraints: [],
  doingNow: [],
  equipment: [],
  goals: [],
  detours: [],
  today: '2026-10-31',
};

describe('buildReviewDossier', () => {
  it('numbers each kind on its own, in the order the review reads them', () => {
    const facts = buildReviewDossier({
      ...empty,
      constraints: [con('left knee'), con('night shifts', { kind: 'life' })],
      doingNow: ['runs 5k three times a week'],
      equipment: [eq('dumbbells', { created_at: new Date('2026-03-02T10:00:00Z') })],
      goals: [goal('Spartan Ultra Beast', { created_at: '2026-02-01T09:00:00Z' })],
      detours: [{ type: 'travel', start: '2026-06-01', end: '2026-06-14' }],
    });
    expect(facts.map((f) => `${f.id} ${f.kind}`)).toEqual([
      'c1 constraint',
      'c2 constraint',
      'n1 doing_now',
      'e1 equipment',
      'g1 goal',
      'd1 detour',
    ]);
    expect(facts.find((f) => f.id === 'e1')?.added).toBe('2026-03-02');
    expect(facts.find((f) => f.id === 'g1')?.added).toBe('2026-02-01');
    expect(facts.find((f) => f.id === 'c1')?.added).toBeNull();
  });

  it('orders equipment and goals by the day they were written down', () => {
    const facts = buildReviewDossier({
      ...empty,
      equipment: [eq('rower', { created_at: '2026-05-01' }), eq('bench', { created_at: '2026-01-01' })],
    });
    expect(facts.map((f) => `${f.id} ${f.text}`)).toEqual(['e1 bench', 'e2 rower']);
  });

  it.each([
    ['a recommendation they do not own', { equipment: [eq('kettlebell', { owned: false })] }],
    [
      'a retired shoe',
      {
        equipment: [
          eq('Pegasus 40', {
            category: 'footwear',
            wear: {
              tracks_mileage: true,
              accumulated_km: 800,
              threshold_km: 700,
              auto_sum_from: 'healthkit_runs',
              status: 'retired',
            },
          }),
        ],
      },
    ],
    ['a parked goal', { goals: [goal('Half marathon', { status: 'parked' })] }],
    ['a completed goal', { goals: [goal('First 5k', { status: 'completed' })] }],
    ['an abandoned goal', { goals: [goal('Daily cold plunge', { status: 'abandoned' })] }],
    ['a blank constraint', { constraints: [con('  ')] }],
    ['a blank doing-now line', { doingNow: [''] }],
    [
      'a constraint whose label is not text',
      { constraints: [{ id: 'x', label: 7, plan_around: true } as unknown as Constraint] },
    ],
    ['a doing-now line that is not text', { doingNow: [null as unknown as string] }],
  ])('leaves out %s', (_label, over) => {
    expect(buildReviewDossier({ ...empty, ...over })).toEqual([]);
  });

  it.each([
    ['captured', 1],
    ['confirmed', 1],
    ['committed', 1],
  ] as const)('keeps a %s goal', (status, n) => {
    expect(buildReviewDossier({ ...empty, goals: [goal('Row 2k', { status })] })).toHaveLength(n);
  });

  it('never reads allergies or dietary choices — the sources carry no field for them', () => {
    const facts = buildReviewDossier({
      ...empty,
      constraints: [con('left knee')],
      // Anything extra a caller passes is ignored: the builder reads only its named fields.
      ...({ dietary: ['peanut allergy'], allergens: ['peanuts'] } as object),
    });
    expect(renderDossier(facts)).not.toMatch(/peanut/i);
  });

  it('says whether a detour has ended, is on now, or is still ahead', () => {
    const facts = buildReviewDossier({
      ...empty,
      today: '2026-10-31',
      detours: [
        { type: 'injury', start: '2026-06-01', end: '2026-08-15' },
        { type: 'travel', start: '2026-10-28', end: '2026-11-04' },
        { type: 'custom', start: '2026-12-20', end: '2026-12-31' },
      ],
    });
    expect(facts.map((f) => f.notes.join('; '))).toEqual([
      '2026-06-01 to 2026-08-15; ended',
      '2026-10-28 to 2026-11-04; on now',
      '2026-12-20 to 2026-12-31; starts later',
    ]);
  });

  it('carries a constraint’s kind, status, end date and plan-around flag', () => {
    const [c] = buildReviewDossier({
      ...empty,
      constraints: [con('travelling for work', { kind: 'life', status: 'quiet', until: '2026-11-07' })],
    });
    expect(c?.notes).toEqual(['life', 'quiet (known, settled for now)', 'until 2026-11-07', 'planned around']);
  });

  it('caps each kind on its own, so a long equipment list never crowds out the constraints', () => {
    const facts = buildReviewDossier({
      ...empty,
      constraints: [con('left knee')],
      equipment: Array.from({ length: 80 }, (_, i) => eq(`item ${i}`)),
    });
    expect(facts.filter((f) => f.kind === 'equipment')).toHaveLength(50);
    expect(facts.filter((f) => f.kind === 'constraint')).toHaveLength(1);
  });

  it('clips a long goal brief', () => {
    const [g] = buildReviewDossier({ ...empty, goals: [goal('Ultra', { brief: 'x'.repeat(500) })] });
    expect(g!.text.length).toBe(200);
    expect(g!.text.endsWith('…')).toBe(true);
  });
});

describe('renderFact', () => {
  it('quotes the words on file, with the day and notes after', () => {
    expect(
      renderFact({ id: 'e1', kind: 'equipment', text: 'gym membership', added: '2026-02-01', notes: ['other'] }),
    ).toBe('[e1] equipment: "gym membership" — added 2026-02-01; other');
    expect(renderFact({ id: 'n1', kind: 'doing_now', text: 'runs 5k', added: null, notes: [] })).toBe(
      '[n1] doing_now: "runs 5k"',
    );
  });
});

describe('dayOf / shiftDay', () => {
  it.each([
    [new Date('2026-03-02T23:30:00Z'), '2026-03-02'],
    ['2026-03-02T10:00:00+00:00', '2026-03-02'],
    ['2026-03-02', '2026-03-02'],
    [new Date('not a date'), null],
    ['March 2nd', null],
    [null, null],
    [undefined, null],
  ])('dayOf(%s) → %s', (input, out) => {
    expect(dayOf(input)).toBe(out);
  });

  it('shifts across a month and a year', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-10-31', -365)).toBe('2025-10-31');
  });
});
