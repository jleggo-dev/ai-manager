/**
 * The Activity Builder's draft, kept on disk so minimizing it is genuinely lossless.
 *
 * Minimize (owner ruling 2026-09-06) is the shell's answer to a nav tap while the builder is up:
 * nothing is asked, because nothing is lost — the screen steps aside and a pill brings it back.
 * That promise has to hold through a force-quit too, or "come back to it later" quietly means
 * "come back to it before iOS reclaims the webview", which is the same broken promise the boot
 * cache exists to fix.
 *
 * Stamped the way the boot snapshot is (lib/query/boot-cache.ts), for the same reasons: a version
 * so an older shape is ignored rather than half-read, an owner so a device with two accounts on it
 * never opens the previous person's draft, and an age so an abandoned one stops haunting the pill.
 * Every read and write is wrapped — private mode and a disabled store are "nothing remembered",
 * never a crash on launch.
 */
import type { UserRoutine } from '../../lib/api/user-routines.ts';
import { isDevMode, getDevAccount } from '../../lib/api/http.ts';
import { readPersistedSession } from '../../lib/persisted-session.ts';
import type { BuilderCard } from './builderSession.ts';
import type { BuilderFamily } from './builderSeeds.ts';

export const BUILDER_DRAFT_KEY = 'cadence.builderDraft';

/** Bump when the stored shape changes; an older draft is then simply not read. Exported so no
 *  test can hand-copy it — the literal that silently stopped matching is a real bug boot-cache
 *  already paid for once. */
export const BUILDER_DRAFT_VERSION = 1;

/**
 * How long an untouched draft stays offerable. Two weeks: long enough that "I'll finish it this
 * weekend" survives, short enough that a thing abandoned a month ago stops presenting itself as
 * unfinished business every launch.
 */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** The builder's own state, in the shape it holds it — no lossy trip through a session. */
export interface BuilderDraft {
  phase: 'type' | 'builder';
  family: BuilderFamily | null;
  cards: BuilderCard[];
  name: string;
  area?: UserRoutine['area'];
  /** Set when the draft is an EDIT of an existing routine rather than a new one. */
  updateRoutineId?: string;
}

interface Stored extends BuilderDraft {
  v: number;
  owner: string | null;
  at: number;
}

/**
 * Whose draft this is. Dev mode has no Supabase session and two interchangeable accounts behind a
 * header, so the dev slug IS the identity — the same rule boot-cache follows, and for the same
 * reason: account 2 must not be handed account 1's half-built activity.
 */
function owner(): string | null {
  if (isDevMode()) return `dev:${getDevAccount()}`;
  return readPersistedSession()?.user?.id ?? null;
}

/** The draft this device is holding, or null. */
export function readDraft(): BuilderDraft | null {
  try {
    const raw = window.localStorage.getItem(BUILDER_DRAFT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Stored>;
    if (s.v !== BUILDER_DRAFT_VERSION) return null;
    if ((s.owner ?? null) !== owner()) return null;
    if (typeof s.at !== 'number' || Date.now() - s.at > MAX_AGE_MS) return null;
    if (!Array.isArray(s.cards)) return null;
    return {
      phase: s.phase === 'builder' ? 'builder' : 'type',
      family: s.family ?? null,
      cards: s.cards,
      name: typeof s.name === 'string' ? s.name : '',
      area: s.area,
      updateRoutineId: s.updateRoutineId,
    };
  } catch {
    return null; // private mode, a disabled store, a key from an older build
  }
}

/**
 * Hold this draft.
 *
 * An EMPTY one is not worth holding, and saying so here rather than at the call site is what stops
 * the pill offering a blank activity: opening the builder, looking at it and tapping away should
 * leave nothing behind. "Empty" is the builder's own `hasEdits` question — no steps and no name.
 */
export function writeDraft(draft: BuilderDraft): void {
  if (draft.cards.length === 0 && !draft.name.trim()) return clearDraft();
  try {
    const stored: Stored = { ...draft, v: BUILDER_DRAFT_VERSION, owner: owner(), at: Date.now() };
    window.localStorage.setItem(BUILDER_DRAFT_KEY, JSON.stringify(stored));
  } catch {
    // Out of quota, private mode, storage disabled. The in-memory draft is untouched and the
    // session keeps working — only the force-quit promise is lost, and silently is the only way
    // to lose it that doesn't interrupt someone mid-sentence.
  }
}

/** Forget it — saved, discarded, or swept when the person changed. */
export function clearDraft(): void {
  try {
    window.localStorage.removeItem(BUILDER_DRAFT_KEY);
  } catch {
    // Nothing to do and nothing to tell anyone.
  }
}
