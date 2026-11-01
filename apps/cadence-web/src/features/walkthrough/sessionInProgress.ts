/**
 * The session you are in the middle of, kept on disk so the app coming back always puts you back
 * in it (owner, 2026-11-01).
 *
 * A session is meant to behave like a running app: lock the phone, the timer keeps going on the
 * lock screen, unlock and you are still in your run. The timer already kept time by the wall clock
 * and the lock screen counted on its own — but the session itself lived only in React state. When
 * iOS reclaimed the webview while the phone sat locked on a piano's music stand, the app came back
 * on the plan with no memory of the practice, while the lock-screen clock was still counting for a
 * session that no longer existed anywhere.
 *
 * Saved on every change while a plan task's walkthrough is open; cleared when it is closed or
 * finished. Stamped like the builder draft (features/builder/draftStore.ts) for the same reasons:
 * a version so an older shape is ignored rather than half-read, an owner so a device with two
 * accounts never reopens the previous person's session, and an age so a session abandoned by a
 * dead battery doesn't spring open tomorrow. Every read and write is wrapped — a disabled store
 * means "nothing remembered", never a crash on launch.
 */
import type { MetronomeSpec, Walkthrough as WalkthroughData } from '@cadence/shared';
import { isDevMode, getDevAccount } from '../../lib/api/http.ts';
import { readPersistedSession } from '../../lib/persisted-session.ts';
import type { StepLogs } from './state.ts';
import type { StepArea } from './tools/MetronomeSlot.tsx';

export const SESSION_IN_PROGRESS_KEY = 'cadence.sessionInProgress';

/** Bump when the stored shape changes; an older snapshot is then simply not read. */
export const SESSION_IN_PROGRESS_VERSION = 1;

/**
 * How long after its last change a session is still "in progress". Twelve hours: a long ruck or
 * an afternoon of practice with the phone untouched fits; yesterday's abandoned session does not
 * reopen itself over today's plan.
 */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** A timer that was RUNNING when the snapshot was taken — the instant it began and what was done
 *  before it, which is all the wall clock needs to carry on as if nothing happened. */
export interface RunningClock {
  stepId: string;
  startedAt: number;
  base: number;
}

export type SessionPhase = 'step' | 'recap' | 'done';

export interface SessionSnapshot {
  occurrenceId: string;
  title: string;
  area?: StepArea;
  /** The run as it was started — a trimmed run comes back trimmed. */
  walkthrough: WalkthroughData;
  idx: number;
  visited: number[];
  logs: StepLogs;
  tempos: Record<string, MetronomeSpec>;
  phase: SessionPhase;
  clock: RunningClock | null;
}

interface Stored extends SessionSnapshot {
  v: number;
  owner: string | null;
  at: number;
}

/** Whose session this is — the same identity rule the builder draft and boot cache follow. */
function owner(): string | null {
  if (isDevMode()) return `dev:${getDevAccount()}`;
  return readPersistedSession()?.user?.id ?? null;
}

/** The session this device is in the middle of, or null. */
export function readSessionInProgress(now = Date.now()): SessionSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SESSION_IN_PROGRESS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Stored>;
    if (s.v !== SESSION_IN_PROGRESS_VERSION) return null;
    if ((s.owner ?? null) !== owner()) return null;
    if (typeof s.at !== 'number' || now - s.at > SESSION_MAX_AGE_MS) return null;
    if (typeof s.occurrenceId !== 'string' || !Array.isArray(s.walkthrough?.steps)) return null;
    const steps = s.walkthrough.steps.length;
    if (steps === 0) return null;
    const idx = typeof s.idx === 'number' && s.idx >= 0 && s.idx < steps ? s.idx : 0;
    return {
      occurrenceId: s.occurrenceId,
      title: typeof s.title === 'string' ? s.title : '',
      area: s.area,
      walkthrough: s.walkthrough,
      idx,
      visited: Array.isArray(s.visited) ? s.visited.filter((i) => typeof i === 'number') : [idx],
      logs: s.logs ?? {},
      tempos: s.tempos ?? {},
      phase: s.phase === 'recap' || s.phase === 'done' ? s.phase : 'step',
      clock: s.clock && typeof s.clock.startedAt === 'number' ? s.clock : null,
    };
  } catch {
    return null;
  }
}

export function writeSessionInProgress(snapshot: SessionSnapshot, now = Date.now()): void {
  try {
    const stored: Stored = { ...snapshot, v: SESSION_IN_PROGRESS_VERSION, owner: owner(), at: now };
    window.localStorage.setItem(SESSION_IN_PROGRESS_KEY, JSON.stringify(stored));
  } catch {
    /* storage unavailable — the session simply isn't remembered across a reload */
  }
}

export function clearSessionInProgress(): void {
  try {
    window.localStorage.removeItem(SESSION_IN_PROGRESS_KEY);
  } catch {
    /* nothing to clear */
  }
}
