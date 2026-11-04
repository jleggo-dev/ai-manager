/**
 * The remembered session — what puts someone back in their practice after iOS reclaimed the app
 * (owner, 2026-11-01). Every refusal is load-bearing, the same way the builder draft's are: a
 * wrong OWNER must never reopen one account's session for the next person, a stale one must not
 * spring open over tomorrow's plan, an older SHAPE is ignored rather than half-read, and a store
 * that throws is "nothing remembered", never a crash on launch.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const persisted = vi.hoisted(() => ({ session: { user: { id: 'u1' } } as { user?: { id?: string } } | null }));
vi.mock('../../lib/persisted-session.ts', () => ({ readPersistedSession: () => persisted.session }));
vi.mock('../../lib/api/http.ts', () => ({ isDevMode: () => false, getDevAccount: () => 'account-1' }));

const {
  SESSION_IN_PROGRESS_KEY,
  SESSION_IN_PROGRESS_VERSION,
  SESSION_MAX_AGE_MS,
  readSessionInProgress,
  writeSessionInProgress,
  clearSessionInProgress,
} = await import('./sessionInProgress.ts');
import type { SessionSnapshot } from './sessionInProgress.ts';

const SNAP: SessionSnapshot = {
  occurrenceId: 'o1',
  title: 'Piano practice',
  area: 'practice',
  walkthrough: {
    total_min: 20,
    steps: [
      { id: 's1', title: 'Scales', minutes: 5, tool: { kind: 'timer', seconds: 300 }, skippable: true },
      { id: 's2', title: 'Écossaise', minutes: 15, tool: { kind: 'timer', seconds: 900 }, skippable: false },
    ],
  },
  idx: 1,
  visited: [0, 1],
  logs: { s1: { kind: 'timer', elapsedSec: 300, targetSec: 300, done: true } },
  tempos: { Écossaise: { bpm: 72, meter: 3 } },
  phase: 'step',
  clock: { stepId: 's2', startedAt: 1_000, base: 0 },
  changes: {},
};

beforeEach(() => {
  persisted.session = { user: { id: 'u1' } };
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('sessionInProgress — the played shape and the turn logs (walkthrough v3 Phase 6)', () => {
  it('round-trips a rearranged shape and the turn logs; a snapshot written before they existed reads back without them', () => {
    const shaped: SessionSnapshot = {
      ...SNAP,
      shape: [{ id: 'g3', turns: [{ stepId: 's1', set: 0 }, { stepId: 's2', set: 0 }], mode: 'alternate' }],
      turnLogs: { 's1:0': { value: 300 } },
    };
    writeSessionInProgress(shaped);
    expect(readSessionInProgress()).toEqual(shaped);
    writeSessionInProgress(SNAP);
    const back = readSessionInProgress();
    expect(back?.shape).toBeUndefined();
    expect(back?.turnLogs).toBeUndefined();
  });
});

describe('sessionInProgress', () => {
  it('reads back exactly what was written — step, logs, tempo and the running clock', () => {
    writeSessionInProgress(SNAP);
    expect(readSessionInProgress()).toEqual(SNAP);
  });

  it('round-trips a swap and per-set loads; a snapshot written before changes existed reads back with none', () => {
    const changed: SessionSnapshot = {
      ...SNAP,
      logs: { s1: { kind: 'reps', sets: [12, 12], load: 'bodyweight', loads: ['15 lb', '20 lb'] } },
      changes: {
        s1: {
          swap: { name: 'Kettlebell hip thrust', sets: 2, reps: 12, load: '40 lb', equipment: ['Bench'] },
          load: '20 lb',
        },
      },
    };
    writeSessionInProgress(changed);
    expect(readSessionInProgress()).toEqual(changed);
    const { changes: _c, ...older } = changed;
    void _c;
    localStorage.setItem(
      SESSION_IN_PROGRESS_KEY,
      JSON.stringify({ ...older, v: SESSION_IN_PROGRESS_VERSION, owner: 'u1', at: Date.now() }),
    );
    expect(readSessionInProgress()?.changes).toEqual({});
  });

  it('clear forgets it', () => {
    writeSessionInProgress(SNAP);
    clearSessionInProgress();
    expect(readSessionInProgress()).toBeNull();
  });

  it('is still there just inside the age limit, gone just past it', () => {
    writeSessionInProgress(SNAP, 0);
    expect(readSessionInProgress(SESSION_MAX_AGE_MS)).not.toBeNull();
    expect(readSessionInProgress(SESSION_MAX_AGE_MS + 1)).toBeNull();
  });

  it("never reopens another account's session", () => {
    writeSessionInProgress(SNAP);
    persisted.session = { user: { id: 'u2' } };
    expect(readSessionInProgress()).toBeNull();
  });

  it('ignores an older shape rather than half-reading it', () => {
    writeSessionInProgress(SNAP);
    const raw = JSON.parse(localStorage.getItem(SESSION_IN_PROGRESS_KEY) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(SESSION_IN_PROGRESS_KEY, JSON.stringify({ ...raw, v: SESSION_IN_PROGRESS_VERSION - 1 }));
    expect(readSessionInProgress()).toBeNull();
  });

  it('a step index past the end opens on the first step rather than nothing', () => {
    writeSessionInProgress({ ...SNAP, idx: 9 });
    expect(readSessionInProgress()?.idx).toBe(0);
  });

  it('garbage on disk is nothing remembered', () => {
    localStorage.setItem(SESSION_IN_PROGRESS_KEY, '{not json');
    expect(readSessionInProgress()).toBeNull();
  });

  it('a store that throws is nothing remembered, never a crash', () => {
    writeSessionInProgress(SNAP);
    // On the instance, not Storage.prototype: this environment's localStorage doesn't route
    // through the prototype, so a prototype spy would pass without ever throwing.
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    expect(() => writeSessionInProgress(SNAP)).not.toThrow();
    expect(() => clearSessionInProgress()).not.toThrow();
    expect(readSessionInProgress()).toBeNull();
  });
});
