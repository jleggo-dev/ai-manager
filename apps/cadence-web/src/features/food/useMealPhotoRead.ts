import { useCallback, useEffect, useRef, useState } from 'react';
import { READ_PHOTO_STEPS, NUTRITION_STEPS, readProgressLine, type MealKind } from '@cadence/shared';
import { readMealPhoto, previewMealFromReading, type MealPreview } from '../../lib/api.ts';
import { NO_FOODS, READ_FAILED, TOO_LONG, WORK_OUT_FAILED } from './photoReadCopy.ts';

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
/** Stage 2 measured 4–14s typed, longer with the extra lookup round and FatSecret on the line. */
export const NUTRITION_BOUND_MS = 120_000;

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

export function useMealPhotoRead() {
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
  /**
   * Each call holds its own token; only the CURRENT call may set phase or error or clear the timer.
   * Without it a superseded call's abort landed as TOO_LONG over the new call's phase, and its
   * `finally` cleared the new call's timer (review of #457, round 2).
   */
  const seq = useRef(0);
  const inFlight = useRef<{ token: number; ctrl: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);

  /** One interval for the life of a stage; `phase` decides which script it is reading from. */
  useEffect(() => {
    if (phase !== 'reading' && phase !== 'nutrition') return;
    const steps = phase === 'reading' ? READ_PHOTO_STEPS : NUTRITION_STEPS;
    const tick = () => setProgress(readProgressLine(steps, Date.now() - startedAt.current));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [phase]);

  /** Drop whatever is in flight: its abort is its own business, nothing it does reaches the screen. */
  const dropInFlight = useCallback((reason: string) => {
    const prior = inFlight.current;
    if (!prior) return;
    inFlight.current = null;
    clearTimeout(prior.timer);
    prior.ctrl.abort(new DOMException(reason, 'AbortError'));
  }, []);

  /** A bounded call with its own token: its signal aborts at the bound, or when it is superseded or left. */
  const begin = useCallback(
    (bound: number): { signal: AbortSignal; token: number } => {
      dropInFlight('superseded');
      const token = ++seq.current;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new DOMException('took too long', 'TimeoutError')), bound);
      inFlight.current = { token, ctrl, timer };
      return { signal: ctrl.signal, token };
    },
    [dropInFlight],
  );
  /** True while this call is still the one the screen is waiting on. */
  const current = (token: number): boolean => token === seq.current;
  const end = useCallback((token: number) => {
    if (inFlight.current?.token !== token) return;
    clearTimeout(inFlight.current.timer);
    inFlight.current = null;
  }, []);

  /** Leaving the door: whatever is in flight is abandoned, and nothing it returns is shown. */
  const cancel = useCallback(() => {
    seq.current += 1;
    dropInFlight('left');
  }, [dropInFlight]);
  useEffect(() => () => cancel(), [cancel]);

  /** Step 1. Resolves to the reading so a caller can chain without waiting on a re-render. */
  const read = useCallback(
    async (photo: string, caption?: string): Promise<string> => {
      setError(null);
      setFailedAt(null);
      setReadFailed(false);
      setPreview(null);
      setReading('');
      startedAt.current = Date.now();
      setPhase('reading');
      const { signal, token } = begin(READ_BOUND_MS);
      try {
        const out = await readMealPhoto(photo, caption, { signal });
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
      }
    },
    [begin, end],
  );

  /**
   * Step 2, with the reading as the person is willing to stand behind it. The rows come back for
   * the card; the photo and the reading ride on the preview so the card's confirm keeps them on
   * the row. Resolves to the preview, or null when the read did not go through.
   */
  const commit = useCallback(
    async (opts: { caption?: string; meal?: MealKind; reading?: string } = {}): Promise<MealPreview | null> => {
      const said = opts.reading ?? reading;
      setError(null);
      setFailedAt(null);
      startedAt.current = Date.now();
      setPhase('nutrition');
      const { signal, token } = begin(NUTRITION_BOUND_MS);
      try {
        const p = await previewMealFromReading({ reading: said, caption: opts.caption, meal: opts.meal }, { signal });
        if (!current(token)) return null;
        if (!p.items.length) throw Object.assign(new Error('no foods'), { status: 400 });
        const priced: MealPreview = {
          ...p,
          ...(photoRef ? { photo_ref: photoRef } : {}),
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
      }
    },
    [begin, end, photoRef, reading],
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
    unprice,
    cancel,
    reset,
  };
}
