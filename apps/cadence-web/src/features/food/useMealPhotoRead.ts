import { useCallback, useEffect, useRef, useState } from 'react';
import { READ_PHOTO_STEPS, NUTRITION_STEPS, readProgressLine, type MealKind } from '@cadence/shared';
import { readMealPhoto, previewMealFromReading, type MealPreview } from '../../lib/api.ts';
import { newRequestId } from '../../lib/api/kept-answers.ts';
import { NO_FOODS, READ_FAILED, TOO_LONG, WORK_OUT_FAILED } from './photoReadCopy.ts';
import { clearReadInProgress, rememberRead, type ReadInProgress } from './readInProgress.ts';
import { useBoundedCall } from './useBoundedCall.ts';

/**
 * Photographing a meal, narrated.
 *
 * The two-stage read costs 40–70s. Owner's ruling (2026-08-21): don't hide that, show it —
 * *"provide information back to the user step by step… this gives the user the perception of
 * movement and change. Any LLM message takes time; the boredom is alleviated usually by seeing the
 * stream of reasoning."*
 *
 * So the wait has a shape:
 *
 *   reading (rotating copy)  →  THE READING ITSELF, on screen  →  nutrition (rotating copy)  →  priced
 *
 * The middle is what makes this more than a well-mannered spinner: the eyes' own words arrive at
 * ~15–35s, so the person learns what they concluded — a few sentences, then the list, one food a
 * line with the amount first — while nothing has been counted yet, and `setReading` lets them fix
 * it before it is.
 *
 * `commit` then sends the reading they stand behind through the SAME read a typed meal gets
 * (FOOD-LOGGING-COACH-LED.md, build step 4): the list's lines are looked up, the coach decides
 * once, the store prices, and the rows come back with her trace, assumptions and questions for
 * the typed door's card. Nothing is written here in either mode — the card's confirm logs the meal
 * (with the photo and the reading on it) or adds the rows to the open meal.
 *
 * Faults are told in plain words, never as an API string, and say what to do next (photoReadCopy.ts):
 * a read the eyes could not make leaves the box open and empty with the caption still counting
 * (`readFailed`); a fault working the meal out keeps the person's corrections for "Back to the
 * reading" (`failedAt`). Both calls are bounded (READ_BOUND_MS, NUTRITION_BOUND_MS — stage 2 may run
 * two model calls and a round of lookups) and aborted when the person leaves (`cancel`), so a hung
 * request never traps them in the door.
 *
 * The ticker is a 500ms interval rather than a chain of timeouts, so a stage that finishes early
 * needs no cleanup bookkeeping and a stage that runs long simply holds its last line.
 */
export type ReadPhase = 'idle' | 'reading' | 'confirming' | 'nutrition' | 'priced' | 'error';
export type ReadStage = 'read' | 'nutrition';

/** Stage 1 measured 11–35s; a slow model is not a bug, a minute and a half is a hang. */
export const READ_BOUND_MS = 90_000;
/** Stage 2 measured 4–14s typed, longer with the extra lookup round and FatSecret on the line, and up to a minute more when that round sends a maker-named part to the web. */
export const NUTRITION_BOUND_MS = 150_000;

// By name, not `instanceof Error`: a DOMException is not an Error in every runtime the tests use.
const nameOf = (e: unknown): string | undefined =>
  e && typeof e === 'object' && 'name' in e ? String((e as { name?: unknown }).name) : undefined;
const isAbort = (e: unknown): boolean => nameOf(e) === 'AbortError' || nameOf(e) === 'TimeoutError';
const statusOf = (e: unknown): number | undefined =>
  e && typeof e === 'object' && 'status' in e ? (e as { status?: number }).status : undefined;

/** What the person is told, by stage and fault — never the error's own words. */
export function faultCopy(stage: ReadStage, e: unknown): string {
  if (isAbort(e)) return TOO_LONG;
  if (stage === 'read') return READ_FAILED;
  return statusOf(e) === 400 ? NO_FOODS : WORK_OUT_FAILED;
}

/** Where the photo door stands: the slot, the date and the picture a read in flight is remembered with. */
export interface PhotoReadMemory {
  meal: MealKind;
  date: string;
  photo: string;
}

/** The read the photo door is in the middle of, for a relaunch (readInProgress.ts) — only inside a dated meal. */
function rememberPhotoRead(
  where: PhotoReadMemory | undefined,
  read: Pick<ReadInProgress, 'kind' | 'words' | 'requestId'> & Pick<Partial<ReadInProgress>, 'reading' | 'photoRef'>,
): void {
  if (!where) return;
  rememberRead({ door: 'photo', meal: where.meal, date: where.date, photo: where.photo, ...read });
}

export function useMealPhotoRead(remember?: PhotoReadMemory) {
  // Held in a ref so the two calls below keep their identity across renders of the panel.
  const memory = useRef(remember);
  memory.current = remember;
  const [phase, setPhase] = useState<ReadPhase>('idle');
  const [progress, setProgress] = useState('');
  const [reading, setReading] = useState('');
  const [photoRef, setPhotoRef] = useState('');
  const [preview, setPreview] = useState<MealPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which stage the error came from, so the door can offer the right way back. */
  const [failedAt, setFailedAt] = useState<ReadStage | null>(null);
  /** The eyes answered but could not read the photo: the box is open and empty, the caption still counts. */
  const [readFailed, setReadFailed] = useState(false);
  const startedAt = useRef(0);
  // Each call holds its own token; only the CURRENT call may set phase or error (useBoundedCall).
  const { begin, end, current, cancel } = useBoundedCall();

  /** One interval for the life of a stage; `phase` decides which script it is reading from. */
  useEffect(() => {
    if (phase !== 'reading' && phase !== 'nutrition') return;
    const steps = phase === 'reading' ? READ_PHOTO_STEPS : NUTRITION_STEPS;
    const tick = () => setProgress(readProgressLine(steps, Date.now() - startedAt.current));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [phase]);

  /**
   * Step 1. Resolves to the reading so a caller can chain without waiting on a re-render. With
   * `pickUp`, the read the app was relaunched in the middle of: asked after under its remembered
   * id, the photo sent again only if the server never got it.
   */
  const read = useCallback(
    async (photo: string, caption?: string, pickUp?: ReadInProgress): Promise<string> => {
      setError(null);
      setFailedAt(null);
      setReadFailed(false);
      setPreview(null);
      setReading('');
      startedAt.current = Date.now();
      setPhase('reading');
      const { signal, token } = begin(READ_BOUND_MS);
      // Remembered for a relaunch while it runs; forgotten once it settles.
      const requestId = pickUp?.requestId ?? newRequestId();
      rememberPhotoRead(memory.current, { kind: 'photo_read', words: caption ?? '', requestId });
      try {
        const out = await readMealPhoto(photo, caption, { signal, requestId, resume: !!pickUp });
        if (!current(token)) return '';
        setPhotoRef(out.photo_ref);
        setReading(out.reading);
        // The photo is up but the eyes could not read it (a 200 with `error`): the box stays open
        // and empty for them to say what it was, and the caption still counts — the 2026-08-20 rule.
        setReadFailed(!!out.error && !out.reading.trim());
        setPhase('confirming');
        return out.reading;
      } catch (e) {
        if (!current(token)) return '';
        setError(faultCopy('read', e));
        setFailedAt('read');
        setPhase('error');
        return '';
      } finally {
        end(token);
        clearReadInProgress();
      }
    },
    [begin, end, current],
  );

  /**
   * Step 2, with the reading as the person is willing to stand behind it. The rows come back for
   * the card; the photo and the reading ride on the preview so the card's confirm keeps them on
   * the row. Resolves to the preview, or null when the read did not go through.
   */
  const commit = useCallback(
    async (
      opts: { caption?: string; meal?: MealKind; reading?: string } = {},
      pickUp?: ReadInProgress,
    ): Promise<MealPreview | null> => {
      const said = opts.reading ?? reading;
      // On a relaunch the stored photo's ref comes from the record, not from a state set a tick ago.
      const ref = pickUp?.photoRef ?? photoRef;
      setError(null);
      setFailedAt(null);
      startedAt.current = Date.now();
      setPhase('nutrition');
      const { signal, token } = begin(NUTRITION_BOUND_MS);
      const requestId = pickUp?.requestId ?? newRequestId();
      rememberPhotoRead(memory.current, {
        kind: 'photo_preview',
        words: opts.caption ?? '',
        reading: said,
        requestId,
        ...(ref ? { photoRef: ref } : {}),
      });
      try {
        const p = await previewMealFromReading(
          { reading: said, caption: opts.caption, meal: opts.meal },
          { signal, requestId, resume: !!pickUp },
        );
        if (!current(token)) return null;
        if (!p.items.length) throw Object.assign(new Error('no foods'), { status: 400 });
        const priced: MealPreview = {
          ...p,
          ...(ref ? { photo_ref: ref } : {}),
          ...(said.trim() ? { photo_reading: said } : {}),
        };
        setPreview(priced);
        setPhase('priced');
        return priced;
      } catch (e) {
        if (!current(token)) return null;
        setError(faultCopy('nutrition', e));
        setFailedAt('nutrition');
        setPhase('error');
        return null;
      } finally {
        end(token);
        clearReadInProgress();
      }
    },
    [begin, end, current, photoRef, reading],
  );

  /**
   * The read the app was relaunched in the middle of (readInProgress.ts): the picture and the words
   * are back in place, and the stage that was running is asked after under its remembered id.
   */
  const resume = useCallback(
    async (r: ReadInProgress): Promise<void> => {
      if (r.kind === 'photo_read') {
        await read(r.photo ?? '', r.words || undefined, r);
        return;
      }
      if (r.photoRef) setPhotoRef(r.photoRef);
      setReading(r.reading ?? '');
      await commit({ caption: r.words || undefined, meal: r.meal, reading: r.reading ?? '' }, r);
    },
    [read, commit],
  );

  const reset = useCallback(() => {
    cancel();
    setPhase('idle');
    setProgress('');
    setReading('');
    setPhotoRef('');
    setPreview(null);
    setError(null);
    setFailedAt(null);
    setReadFailed(false);
  }, [cancel]);

  /** Back to the reading — from the numbers to fix and price again, or from a fault, keeping every correction. */
  const unprice = useCallback(() => {
    setPreview(null);
    setError(null);
    setFailedAt(null);
    setPhase('confirming');
  }, []);

  return {
    phase,
    progress,
    reading,
    setReading,
    photoRef,
    preview,
    error,
    failedAt,
    readFailed,
    read,
    commit,
    resume,
    unprice,
    cancel,
    reset,
  };
}
