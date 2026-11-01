import { useCallback, useEffect, useRef, useState } from 'react';
import { READ_PHOTO_STEPS, NUTRITION_STEPS, readProgressLine, type MealKind } from '@cadence/shared';
import { readMealPhoto, previewMealFromReading, type MealPreview } from '../../lib/api.ts';

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
 * (with the photo and the reading on it) or adds the rows to the open meal. Until 2026-11-01 log
 * mode wrote a row straight from `parse-meal-description` with no card and no trace.
 *
 * The ticker is a 500ms interval rather than a chain of timeouts, so a stage that finishes early
 * needs no cleanup bookkeeping and a stage that runs long simply holds its last line.
 */
export type ReadPhase = 'idle' | 'reading' | 'confirming' | 'nutrition' | 'priced' | 'error';

export function useMealPhotoRead() {
  const [phase, setPhase] = useState<ReadPhase>('idle');
  const [progress, setProgress] = useState('');
  const [reading, setReading] = useState('');
  const [photoRef, setPhotoRef] = useState('');
  const [preview, setPreview] = useState<MealPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  /** One interval for the life of a stage; `phase` decides which script it is reading from. */
  useEffect(() => {
    if (phase !== 'reading' && phase !== 'nutrition') return;
    const steps = phase === 'reading' ? READ_PHOTO_STEPS : NUTRITION_STEPS;
    const tick = () => setProgress(readProgressLine(steps, Date.now() - startedAt.current));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [phase]);

  /** Step 1. Resolves to the reading so a caller can chain without waiting on a re-render. */
  const read = useCallback(async (photo: string, caption?: string): Promise<string> => {
    setError(null);
    setPreview(null);
    setReading('');
    startedAt.current = Date.now();
    setPhase('reading');
    try {
      const out = await readMealPhoto(photo, caption);
      setPhotoRef(out.photo_ref);
      setReading(out.reading);
      setPhase('confirming');
      return out.reading;
    } catch (e) {
      // The photo may still have uploaded; what failed is the reading. The caller can offer to go
      // on from the caption alone rather than losing the meal — the 2026-08-20 rule.
      setError(e instanceof Error ? e.message : 'could not read that photo');
      setPhase('error');
      return '';
    }
  }, []);

  /**
   * Step 2, with the reading as the person is willing to stand behind it. The rows come back for
   * the card; the photo and the reading ride on the preview so the card's confirm keeps them on
   * the row. Resolves to the preview, or null when the read did not go through.
   */
  const commit = useCallback(
    async (opts: { caption?: string; meal?: MealKind; reading?: string } = {}): Promise<MealPreview | null> => {
      const said = opts.reading ?? reading;
      startedAt.current = Date.now();
      setPhase('nutrition');
      try {
        const p = await previewMealFromReading({ reading: said, caption: opts.caption, meal: opts.meal });
        if (!p.items.length) throw new Error('I couldn’t pick any foods out of that — try adding a few words.');
        const priced: MealPreview = {
          ...p,
          ...(photoRef ? { photo_ref: photoRef } : {}),
          ...(said.trim() ? { photo_reading: said } : {}),
        };
        setPreview(priced);
        setPhase('priced');
        return priced;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not work out that meal');
        setPhase('error');
        return null;
      }
    },
    [photoRef, reading],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setProgress('');
    setReading('');
    setPhotoRef('');
    setPreview(null);
    setError(null);
  }, []);

  /** Back from the numbers to the reading, to fix what it says and price it again. */
  const unprice = useCallback(() => {
    setPreview(null);
    setPhase('confirming');
  }, []);

  return { phase, progress, reading, setReading, photoRef, preview, error, read, commit, unprice, reset };
}
