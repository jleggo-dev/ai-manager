import { describe, expect, it } from 'vitest';
import { buildNutritionInsight, type NutritionInsightDayInput } from './nutrition-insight.ts';
import type { NutritionSummary } from '@cadence/shared';

const emptySummary = (over: Partial<NutritionSummary> = {}): NutritionSummary => ({
  window_days: 7,
  days_logged: 0,
  meals_logged: 0,
  meals_per_logged_day: 0,
  top_items: [],
  alcohol_days: 0,
  caffeine_days: 0,
  ...over,
});

const day = (over: Partial<NutritionInsightDayInput> = {}): NutritionInsightDayInput => ({
  date: '2026-07-25',
  meals: [],
  totals: {},
  targets: null,
  left: null,
  confirmed_count: 0,
  provisional_count: 0,
  ...over,
});

describe('buildNutritionInsight (Req 5 WS-I)', () => {
  it('stays quiet when there is no day or window signal', () => {
    const pack = buildNutritionInsight(day(), emptySummary());
    expect(pack.primary).toBeNull();
    expect(pack.status).toBe('quiet');
  });

  it('surfaces a protein shortfall from day.left (does not re-sum meals)', () => {
    const pack = buildNutritionInsight(
      day({
        confirmed_count: 2,
        totals: { kcal: 1400, protein_g: 60 },
        targets: { kcal: 2000, protein_g: 140 },
        left: { kcal: 600, protein_g: 80 },
        meals: [
          {
            meal: 'lunch',
            items: [{ name: 'chicken bowl' }],
            macros: { kcal: 700, protein_g: 40 },
            provisional: false,
          },
        ],
      }),
      emptySummary({ days_logged: 4, meals_logged: 8 }),
    );
    expect(pack.status).toBe('room_left');
    expect(pack.primary?.kind).toBe('macro');
    expect(pack.primary?.body).toMatch(/80g short/i);
    expect(pack.primary?.body).toMatch(/want an easy add/i);
    // Drill uses the totals passed in — not recomputed from meal rows.
    expect(pack.drill.macros.find((m) => m.key === 'protein_g')).toMatchObject({
      eaten: 60,
      target: 140,
      left: 80,
    });
  });

  it('soft-voices a little over without shame', () => {
    const pack = buildNutritionInsight(
      day({
        confirmed_count: 3,
        totals: { kcal: 2300, protein_g: 120 },
        targets: { kcal: 2000, protein_g: 120 },
        left: { kcal: 0, protein_g: 0 },
        meals: [
          {
            meal: 'dinner',
            items: [{ name: 'pasta' }],
            macros: { kcal: 900 },
            provisional: false,
          },
        ],
      }),
      emptySummary({ days_logged: 5, meals_logged: 10 }),
    );
    expect(pack.status).toBe('a_little_over');
    expect(pack.status_line.toLowerCase()).toContain('a little over');
    expect(pack.primary?.body).toMatch(/a little high/i);
    expect(pack.primary?.body).not.toMatch(/fail|blew|bad|shame/i);
  });

  it('detects late-day calorie pattern from recent logs', () => {
    const recent = [
      { date: '2026-07-20', meal: 'breakfast' as const, macros: { kcal: 200 }, provisional: false, items: [] },
      { date: '2026-07-20', meal: 'dinner' as const, macros: { kcal: 900 }, provisional: false, items: [] },
      { date: '2026-07-21', meal: 'lunch' as const, macros: { kcal: 300 }, provisional: false, items: [] },
      { date: '2026-07-21', meal: 'snack' as const, macros: { kcal: 700 }, provisional: false, items: [] },
      { date: '2026-07-22', meal: 'dinner' as const, macros: { kcal: 800 }, provisional: false, items: [] },
    ];
    const pack = buildNutritionInsight(
      day({ confirmed_count: 0, meals: [] }),
      emptySummary({ days_logged: 3, meals_logged: 5 }),
      recent,
    );
    expect(pack.primary?.kind).toBe('pattern');
    expect(pack.primary?.body).toMatch(/later in the day/i);
  });

  it('offers a variety nudge when the log is beige without greens', () => {
    const recent = [
      {
        date: '2026-07-20',
        meal: 'lunch' as const,
        macros: { kcal: 500 },
        provisional: false,
        items: [{ name: 'pasta' }, { name: 'bread' }],
      },
      {
        date: '2026-07-21',
        meal: 'dinner' as const,
        macros: { kcal: 600 },
        provisional: false,
        items: [{ name: 'pizza' }, { name: 'chips' }],
      },
      {
        date: '2026-07-22',
        meal: 'lunch' as const,
        macros: { kcal: 450 },
        provisional: false,
        items: [{ name: 'bagel' }, { name: 'cheese' }],
      },
      {
        date: '2026-07-23',
        meal: 'dinner' as const,
        macros: { kcal: 500 },
        provisional: false,
        items: [{ name: 'rice' }, { name: 'noodles' }],
      },
    ];
    const pack = buildNutritionInsight(
      day(),
      emptySummary({
        days_logged: 4,
        meals_logged: 4,
        top_items: [
          { name: 'pasta', count: 2 },
          { name: 'bread', count: 2 },
        ],
      }),
      recent,
    );
    expect(pack.primary?.kind).toBe('variety');
    expect(pack.primary?.body).toMatch(/beige|spinach|berries/i);
  });

  it('puts extra insights in more for drill-down', () => {
    const recent = [
      {
        date: '2026-07-20',
        meal: 'dinner' as const,
        macros: { kcal: 900 },
        provisional: false,
        flags: { alcohol: true },
        items: [{ name: 'pasta' }],
      },
      {
        date: '2026-07-21',
        meal: 'snack' as const,
        macros: { kcal: 700 },
        provisional: false,
        flags: { alcohol: true },
        items: [{ name: 'pizza' }],
      },
      {
        date: '2026-07-22',
        meal: 'dinner' as const,
        macros: { kcal: 800 },
        provisional: false,
        items: [{ name: 'bread' }, { name: 'cheese' }],
      },
      {
        date: '2026-07-23',
        meal: 'dinner' as const,
        macros: { kcal: 750 },
        provisional: false,
        items: [{ name: 'rice' }, { name: 'chips' }],
      },
    ];
    const pack = buildNutritionInsight(
      day({
        confirmed_count: 1,
        totals: { kcal: 1200, protein_g: 50 },
        targets: { kcal: 2000, protein_g: 140 },
        left: { kcal: 800, protein_g: 90 },
        meals: [
          {
            meal: 'lunch',
            items: [{ name: 'sandwich' }],
            macros: { kcal: 500, protein_g: 20 },
            provisional: false,
          },
        ],
      }),
      emptySummary({ days_logged: 4, meals_logged: 8, alcohol_days: 2 }),
      recent,
    );
    expect(pack.primary?.kind).toBe('macro');
    expect(pack.more.length).toBeGreaterThan(0);
    expect(pack.more.some((m) => m.kind === 'pattern' || m.kind === 'variety')).toBe(true);
  });
});
