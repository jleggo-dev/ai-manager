import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `log_meal` is thin over `logMeal` (nutrition.ts) — the same plain-text quick-add
 * `POST /nutrition/meals` already runs. What is tested here is the translation: a bad call never
 * reaches the service, a thrown write never claims a log that did not happen (TOOL-HARNESS §5),
 * and — the part that matters for this parcel — a provisional row is told to her as UNSETTLED
 * rather than reported the same way as a clean one.
 */
vi.mock('./nutrition.ts', () => ({ logMeal: vi.fn() }));

import { logMeal } from './nutrition.ts';
import { LOG_MEAL } from './coach-action-log-meal.ts';

beforeEach(() => {
  vi.mocked(logMeal).mockReset();
});

describe('log_meal — bad calls never reach the service', () => {
  it('refuses blank text without calling logMeal', async () => {
    const out = await LOG_MEAL.run('u1', { text: '   ' });
    expect(out).toContain('No food was named');
    expect(logMeal).not.toHaveBeenCalled();
  });

  it('drops an unrecognised meal value rather than passing it through', async () => {
    vi.mocked(logMeal).mockResolvedValue({
      date: '2026-08-28',
      meal: 'other',
      items: [{ name: 'toast' }],
      macros: { kcal: 120 },
      provisional: false,
    } as never);
    await LOG_MEAL.run('u1', { text: 'toast', meal: 'brunch' });
    expect(logMeal).toHaveBeenCalledWith('u1', { text: 'toast', meal: undefined, date: undefined });
  });

  it('drops a malformed date rather than passing it through', async () => {
    vi.mocked(logMeal).mockResolvedValue({
      date: '2026-08-28',
      meal: 'other',
      items: [{ name: 'toast' }],
      macros: { kcal: 120 },
      provisional: false,
    } as never);
    await LOG_MEAL.run('u1', { text: 'toast', date: 'yesterday' });
    expect(logMeal).toHaveBeenCalledWith('u1', { text: 'toast', meal: undefined, date: undefined });
  });

  it('forwards a valid meal and date exactly as given', async () => {
    vi.mocked(logMeal).mockResolvedValue({
      date: '2026-08-20',
      meal: 'lunch',
      items: [{ name: 'chili' }],
      macros: { kcal: 400 },
      provisional: false,
    } as never);
    await LOG_MEAL.run('u1', { text: 'leftover chili', meal: 'lunch', date: '2026-08-20' });
    expect(logMeal).toHaveBeenCalledWith('u1', { text: 'leftover chili', meal: 'lunch', date: '2026-08-20' });
  });
});

describe('log_meal — a thrown write never claims a log that did not happen', () => {
  it('says it could not be logged, and does not claim success', async () => {
    vi.mocked(logMeal).mockRejectedValue(new Error('db unavailable'));
    const out = await LOG_MEAL.run('u1', { text: 'a protein shake' });
    expect(out).toContain('could not be logged');
    expect(out).not.toMatch(/^logged/i);
  });
});

describe('log_meal — settled vs provisional are told apart', () => {
  it('reports a clean log as bookkeeping — one line, nothing to review', async () => {
    vi.mocked(logMeal).mockResolvedValue({
      date: '2026-08-28',
      meal: 'snack',
      items: [{ name: 'protein shake' }, { brand: 'Chiquita', name: 'banana' }],
      macros: { kcal: 260 },
      provisional: false,
    } as never);
    const out = await LOG_MEAL.run('u1', { text: 'a protein shake and a banana' });
    expect(out).toContain('Logged:');
    expect(out).toContain('protein shake');
    expect(out).toContain('Chiquita banana');
    expect(out).toContain('260 kcal');
    // Logging is not coaching, and it is not the tool's call whether the coach comments on it (TR-2).
    expect(out).not.toMatch(/bookkeeping|say one short line|not something to review/i);
    expect(out).not.toContain('PROVISIONAL');
  });

  it('flags a provisional row honestly instead of claiming it is fully counted', async () => {
    vi.mocked(logMeal).mockResolvedValue({
      date: '2026-08-28',
      meal: 'dinner',
      items: [{ name: 'mystery leftovers' }],
      macros: null,
      provisional: true,
    } as never);
    const out = await LOG_MEAL.run('u1', { text: 'some mystery leftovers from the fridge' });
    expect(out).toContain('PROVISIONAL');
    expect(out).toContain('nothing priced yet');
    expect(out).toMatch(/not count toward.*totals/i);
    expect(out).not.toMatch(/^logged:/i);
  });
});
