/**
 * The meal read you are in the middle of, kept on disk so the app coming back puts you back in
 * it — the walkthrough's rule (features/walkthrough/sessionInProgress.ts), applied to the quick
 * log's three reading doors (owner, 2026-11-03: "when I come back, the answer I was waiting on
 * is there, or still arriving").
 *
 * A read's connection surviving the app being left is lib/api/kept-answers.ts's job and needs no
 * disk: the request lives in memory and asks after its answer on resume. This is for the case
 * past that — iOS reclaimed the webview while the phone sat locked, and the app relaunches onto
 * the plan with no memory of the sheet, the words, or the request id the answer is kept under.
 * So the door writes this when a read starts and clears it when the read settles or the door is
 * closed; on launch the shell opens the drawer on it (MainTabs → FoodHome → MealScreen), and the
 * door asks after the answer under the remembered id before sending anything.
 *
 * Stamped like the session: a version so an older shape is ignored, an owner so a phone with two
 * accounts never reopens the previous person's read, and an age — a read left a quarter of an
 * hour ago is not reopened (the server's own row reads as lost at five minutes). Every read and
 * write is wrapped: a disabled store means "nothing remembered", never a crash on launch. The
 * photo door's picture rides along (a few hundred KB); a store that refuses it simply does not
 * remember that read.
 */
import type { MealKind } from '@cadence/shared';
import { isDevMode, getDevAccount } from '../../lib/api/http.ts';
import { readPersistedSession } from '../../lib/persisted-session.ts';

export const READ_IN_PROGRESS_KEY = 'cadence.readInProgress';
export const READ_IN_PROGRESS_VERSION = 1;
export const READ_MAX_AGE_MS = 15 * 60_000;

/** Which door was open: "What did you have?", the chat door inside the meal, or the photo door. */
export type ReadDoor = 'describe' | 'chat' | 'photo';

export interface ReadInProgress {
  door: ReadDoor;
  meal: MealKind;
  date: string;
  /** The id the answer is kept under (kept-answers.ts). */
  requestId: string;
  /** Which read: a described meal's words, or the photo door's first or second stage. */
  kind: 'words' | 'photo_read' | 'photo_preview';
  /** The words — the meal as typed or said, or the photo's caption. */
  words: string;
  /** "Not quite": what was wrong, and the rows as shown — the re-read goes out with both. */
  correction?: { words: string; previous: string[] };
  listening?: boolean;
  /** The photo door: the picture, and for the second stage the reading as confirmed and the stored photo's ref. */
  photo?: string;
  reading?: string;
  photoRef?: string;
}

interface Stored extends ReadInProgress {
  v: number;
  owner: string | null;
  at: number;
}

/** Whose read this is — the same identity rule the session and the builder draft follow. */
function owner(): string | null {
  if (isDevMode()) return `dev:${getDevAccount()}`;
  return readPersistedSession()?.user?.id ?? null;
}

const DOORS: readonly ReadDoor[] = ['describe', 'chat', 'photo'];
const KINDS: readonly ReadInProgress['kind'][] = ['words', 'photo_read', 'photo_preview'];

/** The read this device is in the middle of, or null. A read too old to pick up is forgotten. */
export function readReadInProgress(now = Date.now()): ReadInProgress | null {
  try {
    const raw = window.localStorage.getItem(READ_IN_PROGRESS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Stored>;
    if (s.v !== READ_IN_PROGRESS_VERSION) return null;
    if ((s.owner ?? null) !== owner()) return null;
    if (typeof s.at !== 'number' || now - s.at > READ_MAX_AGE_MS) {
      clearReadInProgress();
      return null;
    }
    if (!DOORS.includes(s.door as ReadDoor) || !KINDS.includes(s.kind as ReadInProgress['kind'])) return null;
    if (typeof s.requestId !== 'string' || typeof s.meal !== 'string' || typeof s.date !== 'string') return null;
    return {
      door: s.door as ReadDoor,
      meal: s.meal as MealKind,
      date: s.date,
      requestId: s.requestId,
      kind: s.kind as ReadInProgress['kind'],
      words: typeof s.words === 'string' ? s.words : '',
      ...(s.correction && typeof s.correction.words === 'string'
        ? {
            correction: {
              words: s.correction.words,
              previous: Array.isArray(s.correction.previous) ? s.correction.previous : [],
            },
          }
        : {}),
      ...(s.listening ? { listening: true } : {}),
      ...(typeof s.photo === 'string' ? { photo: s.photo } : {}),
      ...(typeof s.reading === 'string' ? { reading: s.reading } : {}),
      ...(typeof s.photoRef === 'string' ? { photoRef: s.photoRef } : {}),
    };
  } catch {
    return null;
  }
}

export function rememberRead(read: ReadInProgress, now = Date.now()): void {
  try {
    const stored: Stored = { ...read, v: READ_IN_PROGRESS_VERSION, owner: owner(), at: now };
    window.localStorage.setItem(READ_IN_PROGRESS_KEY, JSON.stringify(stored));
  } catch {
    /* storage unavailable or full — the read simply isn't remembered across a relaunch */
  }
}

export function clearReadInProgress(): void {
  try {
    window.localStorage.removeItem(READ_IN_PROGRESS_KEY);
  } catch {
    /* nothing to clear */
  }
}
