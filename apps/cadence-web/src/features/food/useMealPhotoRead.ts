import { useCallback, useEffect, useRef, useState } from 'react';
import { READ_PHOTO_STEPS, NUTRITION_STEPS, readProgressLine, type MealKind } from '@cadence/shared';
import {
  readMealPhoto,
  logMealFromReading,
  previewMealFromReading,
  type Meal,
  type MealPreview,
} from '../../lib/api.ts';

/**
 * Draft mode (meal-logging rework, 1b): the photo door appends into the open meal instead of
 * writing one. The confirmed reading — the user's own corrected words — is priced WITHOUT a write
 * (`previewMealFromReading`) and the hook stops at `priced`, holding the rows: the user sees the
 * foods and their numbers before anything joins the meal (owner, 2026-10-31: "present the
 * nutritional information to the user"). The caller hands the confirmed rows to `appendParsed`.
 *
 * It went through the typed path's `previewMeal` until 2026-10-31, whose 500-character cap a photo
 * reading always overran — every photo added to an open meal failed with a bare 400.
 */
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
 *   reading (rotating copy)  →  THE READING ITSELF, on screen  →  nutrition (rotating copy)  →  done
 *
 * The middle is what makes this more than a well-mannered spinner: the model's own words arrive at
 * ~15–35s, so the user learns what it concluded — "assume a 250ml latte, roughly 200ml milk" —
 * while the arithmetic is still running, and `setReading` lets them fix it before it counts.
 *
 * The ticker is a 500ms interval rather than a chain of timeouts, so a stage that finishes early
 * needs no cleanup bookkeeping and a stage that runs long simply holds its last line.
 */
export type ReadPhase = 'idle' | 'reading' | 'confirming' | 'nutrition' | 'priced' | 'done' | 'error';

export function useMealPhotoRead(draft = false) {
  const [phase, setPhase] = useState<ReadPhase>('idle');
  const [progress, setProgress] = useState('');
  const [reading, setReading] = useState('');
  const [photoRef, setPhotoRef] = useState('');
  const [meal, setMeal] = useState<Meal | null>(null);
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
    setMeal(null);
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
      // The photo may still have uploaded; what failed is the reading. The caller can offer to log
      // from the caption alone rather than losing the meal — the 2026-08-20 rule.
      setError(e instanceof Error ? e.message : 'could not read that photo');
      setPhase('error');
      return '';
    }
  }, []);

  /** Step 2, with the reading as the user is willing to stand behind it. */
  const commit = useCallback(
    async (opts: { caption?: string; meal?: MealKind; reading?: string } = {}): Promise<Meal | null> => {
      startedAt.current = Date.now();
      setPhase('nutrition');
      try {
        if (draft) {
          const p = await previewMealFromReading({
            reading: opts.reading ?? reading,
            caption: opts.caption,
            meal: opts.meal,
          });
          if (!p.items.length) throw new Error('I couldn’t pick any foods out of that — try adding a few words.');
          setPreview(p);
          setPhase('priced');
          return null;
        }
        const row = await logMealFromReading({
          photo_ref: photoRef,
          reading: opts.reading ?? reading,
          caption: opts.caption,
          meal: opts.meal,
        });
        setMeal(row);
        setPhase('done');
        return row;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not log that meal');
        setPhase('error');
        return null;
      }
    },
    [draft, photoRef, reading],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setProgress('');
    setReading('');
    setPhotoRef('');
    setMeal(null);
    setPreview(null);
    setError(null);
  }, []);

  /** Back from the numbers to the reading, to fix what it says and price it again. */
  const unprice = useCallback(() => {
    setPreview(null);
    setPhase('confirming');
  }, []);

  return { phase, progress, reading, setReading, photoRef, meal, preview, error, read, commit, unprice, reset };
}
