/**
 * The screen's value is entirely in where it draws the line, so the false-positive cases are the
 * important half of this file: a coach that refuses "lose 10 lbs" or "practice Rust daily" is a
 * worse product than one with no screen at all.
 */
import { describe, it, expect } from 'vitest';
import { screenGoal, renderScreenNotes, MIN_DAILY_KCAL } from './goal-screen.ts';

describe('goal screen — ordinary goals pass untouched', () => {
  const ok = [
    { title: 'Run a sub-25 5k by October', area: 'movement', measure: { metric: 'time', target: 25, unit: 'min' } },
    {
      title: 'Lose 10 lbs by spring',
      area: 'nourishment',
      measure: { metric: 'weight', target: 170, start: 180, unit: 'lb' },
    },
    { title: 'Practice Rust 30 minutes before work', area: 'practice', measure: { metric: 'minutes', target: 30 } },
    { title: 'Write 500 words a day on my novel', area: 'practice', measure: { metric: 'words', target: 500 } },
    { title: 'Eat 2,000 calories a day', area: 'nourishment', measure: { metric: 'calories', target: 2000 } },
    { title: 'Cut back on drinking to two nights a week', area: 'mind', measure: { metric: 'nights', target: 2 } },
    { title: 'Sit for 10 minutes each morning', area: 'mind', measure: { metric: 'minutes', target: 10 } },
    { title: 'Do a 16:8 intermittent fasting window', area: 'nourishment', measure: { metric: 'hours', target: 16 } },
    { title: 'Assist at the Saturday climbing session', area: 'movement', measure: { metric: 'sessions', target: 1 } },
  ];
  for (const g of ok) {
    it(`passes "${g.title}"`, () => {
      expect(screenGoal(g).verdict).toBe('ok');
    });
  }
});

describe('goal screen — refuses only unambiguous harm', () => {
  it('refuses a purging goal and does not persist it', () => {
    const r = screenGoal({ title: 'Purge after big meals', area: 'nourishment' });
    expect(r.verdict).toBe('refuse');
    expect(r.code).toBe('harm');
    // The note must send the coach toward help, not toward a counter-offer.
    expect(r.note).toMatch(/professional|trust/i);
  });

  it.each([
    'Take a steroid cycle this spring',
    'Use laxatives on heavy days',
    'Water cut before the weigh-in',
    'Starve until Friday',
  ])('refuses "%s"', (title) => {
    expect(screenGoal({ title }).verdict).toBe('refuse');
  });
});

describe('goal screen — reshapes rather than blocks', () => {
  it('flags a sub-floor calorie target and keeps the goal', () => {
    const r = screenGoal({ title: 'Eat 900 calories a day', measure: { metric: 'calories', target: 900 } });
    expect(r.verdict).toBe('reshape');
    expect(r.code).toBe('kcal_floor');
    expect(r.note).toContain(String(MIN_DAILY_KCAL));
  });

  it('flags an unsafe weight-loss rate from the goal window', () => {
    const r = screenGoal({
      title: 'Drop to 70kg',
      measure: { metric: 'weight', target: 70, start: 90, unit: 'kg' },
      timeframe: { start: '2026-08-01', end: '2026-09-01' }, // 20kg in ~4.3 weeks
    });
    expect(r.verdict).toBe('reshape');
    expect(r.code).toBe('loss_rate');
  });

  it('accepts a sane weight-loss rate over a realistic window', () => {
    const r = screenGoal({
      title: 'Drop to 85kg',
      measure: { metric: 'weight', target: 85, start: 90, unit: 'kg' },
      timeframe: { start: '2026-08-01', end: '2026-12-01' }, // 5kg over ~17 weeks
    });
    expect(r.verdict).toBe('ok');
  });

  it('converts pounds before pricing the rate — 30 lb in 6 weeks is not safe', () => {
    const r = screenGoal({
      title: 'Get to 150 by mid-September',
      measure: { metric: 'weight', target: 150, start: 180, unit: 'lb' },
      timeframe: { start: '2026-08-01', end: '2026-09-12' },
    });
    expect(r.code).toBe('loss_rate');
    expect(r.note).toMatch(/2\.\d kg\/week/);
  });

  it('reads the kg baseline as kg when the goal omits a start, even for a lb goal', () => {
    // The mixing bug this guards: an 82kg baseline read as 82 *lb* becomes a 37kg start, which is
    // BELOW the 154lb target — the loss goes negative and the check silently passes a real crash
    // diet. Read correctly it is 82kg → 69.9kg in ~8.7 weeks ≈ 1.4 kg/wk, over the 1%/wk line.
    const r = screenGoal(
      {
        title: 'Get to 154 lb by October',
        measure: { metric: 'weight', target: 154, unit: 'lb' },
        timeframe: { start: '2026-08-01', end: '2026-10-01' },
      },
      82,
    );
    expect(r.code).toBe('loss_rate');
  });

  it('flags a sleep-cutting goal', () => {
    const r = screenGoal({
      title: 'Sleep 5 hours so I can train earlier',
      measure: { metric: 'sleep', target: 5, unit: 'hours' },
    });
    expect(r.verdict).toBe('reshape');
    expect(r.code).toBe('sleep_floor');
  });

  it('reshapes a do-my-work goal but offers the practice version', () => {
    const r = screenGoal({ title: 'Write my code for me every morning' });
    expect(r.verdict).toBe('reshape');
    expect(r.code).toBe('out_of_scope');
    expect(r.note).toMatch(/practice|sitting down/i);
  });

  it('reshapes building a substance habit, not cutting one', () => {
    expect(screenGoal({ title: 'Drink more to unwind' }).code).toBe('substance');
    expect(screenGoal({ title: 'Drink less on weeknights' }).verdict).toBe('ok');
  });
});

describe('renderScreenNotes', () => {
  it('is null when nothing fired, so no empty context turn is injected', () => {
    expect(renderScreenNotes([{ title: 'Run a 5k', result: { verdict: 'ok' } }])).toBeNull();
  });

  it('names the goal and hands the coach the line to raise', () => {
    const out = renderScreenNotes([
      { title: 'Eat 900 calories a day', result: { verdict: 'reshape', code: 'kcal_floor', note: 'say it out loud' } },
      { title: 'Run a 5k', result: { verdict: 'ok' } },
    ]);
    expect(out).toContain('"Eat 900 calories a day"');
    expect(out).not.toContain('Run a 5k');
  });
});
