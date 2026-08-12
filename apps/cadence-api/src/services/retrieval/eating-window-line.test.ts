/**
 * The line a 16:8 eater's coach reads before she offers them breakfast (§A9).
 * Pure — no repos, no DB, no env.
 */
import { describe, it, expect } from 'vitest';
import { renderEatingWindow } from './eating-window-line.ts';

describe('renderEatingWindow', () => {
  it('says the hours and their words for them', () => {
    expect(renderEatingWindow({ said_as: '16:8', windows: [{ earliest: '12:00', latest: '20:00' }] })).toContain(
      'Eating window — their words: "16:8"; eats 12:00–20:00.',
    );
  });

  it('keeps a one-sided edge rather than inventing the other', () => {
    expect(renderEatingWindow({ said_as: 'nothing after eight', windows: [{ latest: '20:00' }] })).toContain(
      'eats until 20:00',
    );
    expect(renderEatingWindow({ said_as: 'first meal at noon', windows: [{ earliest: '12:00' }] })).toContain(
      'eats from 12:00',
    );
  });

  it('keeps a pattern with no clock times at all — she can just ask', () => {
    const line = renderEatingWindow({ said_as: 'I just skip breakfast', windows: [] });
    expect(line).toContain('their words: "I just skip breakfast"');
    expect(line).toContain('they gave no clock times');
  });

  it('names the days when a span only applies to some of them (5:2, weekdays only)', () => {
    const line = renderEatingWindow({
      said_as: '5:2',
      windows: [{ days: ['MO', 'TU', 'WE', 'TH', 'FR'], earliest: '07:00', latest: '21:00' }, { days: ['SA', 'SU'] }],
    });
    // Day order comes from describeRecurrence — the app's one day vocabulary, week starting Sunday.
    expect(line).toContain('eats Mon, Tue, Wed, Thu, Fri 07:00–21:00; Sun, Sat (no times given)');
  });

  it('carries the date it stops being true', () => {
    expect(
      renderEatingWindow({
        said_as: 'Ramadan',
        windows: [{ earliest: '20:00', latest: '04:00' }],
        until: '2026-03-19',
      }),
    ).toContain('eats 20:00–04:00, until 2026-03-19.');
  });

  it('renders nothing when they never said — the common, correct case', () => {
    expect(renderEatingWindow(null)).toBe('');
    expect(renderEatingWindow(undefined)).toBe('');
    expect(renderEatingWindow({ said_as: '   ', windows: [{ earliest: '12:00' }] })).toBe('');
  });

  // A flag exists to be counted, and a count of broken fasts is a scoreboard. There is no
  // off_window field anywhere, and this line must not smuggle one in as an instruction.
  it('tells the coach what to offer, and never to keep score', () => {
    const line = renderEatingWindow({ said_as: 'OMAD', windows: [{ earliest: '18:00', latest: '19:00' }] });
    expect(line).toContain('never offer or ask after a meal they do not eat');
    expect(line).toContain('not a slip');
    expect(line).toContain('never keep score');
    expect(line).not.toMatch(/track|adheren|streak|missed|compliance/i);
  });
});
