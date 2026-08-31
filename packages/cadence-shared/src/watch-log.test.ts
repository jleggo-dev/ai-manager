import { describe, it, expect } from 'vitest';
import {
  normalizeWatchLog,
  watchLogItems,
  watchLogSummary,
  watchLogText,
  WATCH_LOG_MAX_ITEMS,
  WATCH_LOG_MAX_NOTE,
  type WatchSessionLog,
} from './watch-log.ts';

const STAMP = '2026-09-07T09:30:00.000Z';

function log(over: Partial<WatchSessionLog> = {}): WatchSessionLog {
  return {
    occurrenceId: 'occ-1',
    finishedAt: STAMP,
    kind: 'strength',
    items: [],
    ...over,
  };
}

describe('normalizeWatchLog — the wire is not trusted', () => {
  it('accepts a well-formed log', () => {
    const out = normalizeWatchLog({
      occurrenceId: 'occ-1',
      finishedAt: STAMP,
      kind: 'strength',
      items: [{ name: 'Goblet squats', done: true, sets: 1, reps: 5, plannedReps: 8 }],
      felt: 'hard',
      note: 'shoulder was tight',
      elapsedSec: 1500,
    });
    expect(out).toEqual({
      occurrenceId: 'occ-1',
      finishedAt: STAMP,
      kind: 'strength',
      items: [{ name: 'Goblet squats', done: true, sets: 1, reps: 5, plannedReps: 8 }],
      felt: 'hard',
      note: 'shoulder was tight',
      elapsedSec: 1500,
    });
  });

  it('refuses anything without an occurrence id — that is not a log', () => {
    expect(normalizeWatchLog(null)).toBeNull();
    expect(normalizeWatchLog('nope')).toBeNull();
    expect(normalizeWatchLog({})).toBeNull();
    expect(normalizeWatchLog({ occurrenceId: '   ' })).toBeNull();
  });

  it('treats a missing `done` as done — the watch only sends steps it walked', () => {
    const out = normalizeWatchLog({ occurrenceId: 'o', items: [{ name: 'Plank' }] });
    expect(out?.items[0]?.done).toBe(true);
  });

  it('drops an item with no name rather than storing a nameless one', () => {
    const out = normalizeWatchLog({
      occurrenceId: 'o',
      items: [
        { name: '', reps: 5 },
        { name: 'Real', reps: 5 },
      ],
    });
    expect(out?.items.map((i) => i.name)).toEqual(['Real']);
  });

  it('rejects nonsense numbers instead of storing them', () => {
    const out = normalizeWatchLog({
      occurrenceId: 'o',
      items: [{ name: 'X', reps: -4, sets: Number.NaN }],
      rounds: Number.POSITIVE_INFINITY,
      elapsedSec: -1,
    });
    expect(out?.items[0]?.reps).toBeUndefined();
    expect(out?.items[0]?.sets).toBeUndefined();
    expect(out?.rounds).toBeUndefined();
    expect(out?.elapsedSec).toBeUndefined();
  });

  it('ignores a felt value it does not know', () => {
    expect(normalizeWatchLog({ occurrenceId: 'o', felt: 'amazing' })?.felt).toBeUndefined();
    expect(normalizeWatchLog({ occurrenceId: 'o', felt: 'easy' })?.felt).toBe('easy');
  });

  it('falls back to strength for an unknown kind rather than dropping the log', () => {
    expect(normalizeWatchLog({ occurrenceId: 'o', kind: 'telekinesis' })?.kind).toBe('strength');
  });

  it('bounds the item count and the note length', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ name: `Item ${i}` }));
    const out = normalizeWatchLog({ occurrenceId: 'o', items, note: 'x'.repeat(9999) });
    expect(out?.items.length).toBe(WATCH_LOG_MAX_ITEMS);
    expect(out?.note?.length).toBe(WATCH_LOG_MAX_NOTE);
  });

  it('keeps the watch-sent finish time — a queued transfer can land hours late', () => {
    // transferUserInfo holds until the phone is reachable. Stamping on receipt would date a run
    // done at 07:00 to whenever the phone came back.
    expect(normalizeWatchLog({ occurrenceId: 'o', finishedAt: STAMP })?.finishedAt).toBe(STAMP);
  });

  it('substitutes now for an unparseable finish time rather than refusing the log', () => {
    const out = normalizeWatchLog({ occurrenceId: 'o', finishedAt: 'never' });
    expect(out).not.toBeNull();
    expect(Number.isNaN(Date.parse(out?.finishedAt ?? ''))).toBe(false);
  });
});

describe('watchLogItems', () => {
  it('carries the session felt onto each item, where adaptation reads it', () => {
    const items = watchLogItems(
      log({
        felt: 'hard',
        items: [
          { name: 'A', done: true, reps: 5 },
          { name: 'B', done: false },
        ],
      }),
    );
    expect(items).toEqual([
      { name: 'A', done: true, reps: 5, felt: 'hard' },
      { name: 'B', done: false, felt: 'hard' },
    ]);
  });

  it('omits felt entirely when it was not answered', () => {
    const items = watchLogItems(log({ items: [{ name: 'A', done: true }] }));
    expect(items[0] && 'felt' in items[0]).toBe(false);
  });
});

describe('watchLogSummary — counts what happened', () => {
  it('reports rounds for an interval', () => {
    expect(watchLogSummary(log({ kind: 'interval', rounds: 4, elapsedSec: 600 }))).toBe(
      'Done on your watch — 4 rounds, 10 min.',
    );
  });

  it('reports sets done, never sets skipped', () => {
    const s = watchLogSummary(
      log({
        items: [
          { name: 'A', done: true },
          { name: 'B', done: true },
          { name: 'C', done: false },
        ],
      }),
    );
    expect(s).toContain('2 sets');
    expect(s).not.toContain('3');
    expect(s.toLowerCase()).not.toContain('skip');
    expect(s.toLowerCase()).not.toContain('missed');
  });

  it('names an amendment as its own fact, not as a shortfall', () => {
    const s = watchLogSummary(log({ items: [{ name: 'A', done: true, reps: 5, plannedReps: 8 }] }));
    expect(s).toContain('1 amended');
    expect(s).not.toContain('short');
  });

  it('does not call a matching rep count an amendment', () => {
    const s = watchLogSummary(log({ items: [{ name: 'A', done: true, reps: 8, plannedReps: 8 }] }));
    expect(s).not.toContain('amended');
  });

  it("names the sit's returns plainly", () => {
    expect(watchLogSummary(log({ kind: 'sit', cameBack: 3, elapsedSec: 600 }))).toContain('came back 3×');
  });

  it('appends the felt answer when there is one', () => {
    expect(watchLogSummary(log({ felt: 'right', items: [{ name: 'A', done: true }] }))).toBe(
      'Done on your watch — 1 set. Felt right.',
    );
  });

  it('still says something for a session with no facts at all', () => {
    expect(watchLogSummary(log())).toBe('Done on your watch.');
  });

  it('never carries a banned word', () => {
    const rendered = [
      watchLogSummary(log({ kind: 'interval', rounds: 4, felt: 'hard' })),
      watchLogSummary(log({ kind: 'sit', cameBack: 2 })),
      watchLogSummary(log({ items: [{ name: 'A', done: true, reps: 5, plannedReps: 8 }] })),
    ]
      .join(' ')
      .toLowerCase();
    for (const banned of ['captured', 'streak', 'journey', 'unlock', 'empower', 'failed', 'incomplete']) {
      expect(rendered).not.toContain(banned);
    }
  });
});

describe('watchLogText — only the user own words reach the parse', () => {
  it('returns the dictated note', () => {
    expect(watchLogText(log({ note: 'knee felt off on the last set' }))).toBe('knee felt off on the last set');
  });

  it('returns null when there is no note, so no model call is spent', () => {
    // The structured record must never be round-tripped through a parse: it would cost a call to
    // recover facts we were handed, and risk "correcting" a number typed with the crown.
    expect(watchLogText(log({ items: [{ name: 'A', done: true, reps: 5 }], felt: 'hard' }))).toBeNull();
  });
});
