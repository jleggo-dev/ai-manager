/**
 * The Sunday sweep's client state machine (MEAL-LOGGING.md S3/S4 + the P3 contract addenda).
 *
 * Fetch ONCE, carry through the flow: commit leaves a `tidy_ready` residue server-side and
 * `GET /nutrition/sweep` reports null once proposals are empty — so re-fetching mid-flow would
 * read as "nothing on file" while the tidy offer is still owed. Everything after the mount-time
 * GET lives here, in client state.
 *
 *   idle → offered → committing → tidyOffer → tidying → done | reverted
 *                  ↘ dismissed (any pre-commit point)
 *
 * The integrator's wiring (FoodHome is the integrator; this is the whole recipe):
 *
 *   const sw = useFoodSweep();
 *   const [open, setOpen] = useState(false);
 *   {sw.phase === 'offered' && !open && sw.sweep && (
 *     <FoodSweepCard sweep={sw.sweep} onOpen={() => setOpen(true)} />)}
 *   {open && (sw.phase === 'offered' || sw.phase === 'committing') && sw.sweep && (
 *     <FoodSweepSheet sweep={sw.sweep} busy={sw.phase === 'committing'} error={sw.error}
 *       onBack={() => setOpen(false)} onCommit={(ids) => void sw.commit(ids)}
 *       onDismiss={() => { setOpen(false); void sw.dismiss(); }} />)}
 *   {open && (sw.phase === 'tidyOffer' || sw.phase === 'tidying' || sw.phase === 'done'
 *       || sw.phase === 'reverted') && (
 *     <FoodSweepTidy saved={sw.saved} tidyable={sw.tidyable} phase={sw.phase}
 *       tidiedCount={sw.tidiedCount} error={sw.error} onTidy={() => void sw.tidy()}
 *       onSkip={() => { sw.skipTidy(); setOpen(false); }} onUndo={() => void sw.revert()}
 *       onClose={() => setOpen(false)} />)}
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingFoodSweep, Recipe } from '@cadence/shared';
import {
  commitFoodSweep,
  dismissFoodSweep,
  getFoodSweep,
  revertFoodTidy,
  tidyFoodSweep,
} from '../../../lib/api/meal-draft.ts';
import { useInvalidateNutritionDay } from '../../../lib/query/index.ts';
import type { TidyableProposal } from './copy.ts';

export type FoodSweepPhase =
  'idle' | 'offered' | 'committing' | 'tidyOffer' | 'tidying' | 'done' | 'reverted' | 'dismissed';

export function useFoodSweep() {
  const [phase, setPhase] = useState<FoodSweepPhase>('idle');
  const [sweep, setSweep] = useState<PendingFoodSweep | null>(null);
  const [saved, setSaved] = useState<Recipe[]>([]);
  const [tidyable, setTidyable] = useState<TidyableProposal[]>([]);
  const [tidiedCount, setTidiedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const invalidateNutritionDay = useInvalidateNutritionDay();
  const inFlight = useRef(false); // one mutation at a time — a double-tap must not double-write

  // The one GET. Sets are idempotent, so StrictMode's double mount converges on the same state;
  // getFoodSweep soft-fails to null, so a failed read is simply "no sweep this week".
  useEffect(() => {
    void getFoodSweep().then((s) => {
      if (s && s.proposals.length > 0) {
        setSweep((cur) => cur ?? s);
        setPhase((p) => (p === 'idle' ? 'offered' : p));
      }
    });
  }, []);

  /** One commit for the toggled set — never per-proposal accepts. Advances to the tidy offer. */
  const commit = useCallback(
    async (acceptIds: string[]) => {
      if (!sweep || acceptIds.length === 0 || inFlight.current) return;
      inFlight.current = true;
      setPhase('committing');
      setError(null);
      try {
        const r = await commitFoodSweep(acceptIds);
        const byId = new Map(sweep.proposals.map((p) => [p.id, p]));
        setSaved(r.saved);
        setTidyable(
          r.tidy
            .filter((t) => t.log_count > 0)
            .flatMap((t) => {
              const proposal = byId.get(t.proposal_id);
              return proposal ? [{ proposal, logCount: t.log_count }] : [];
            }),
        );
        setPhase('tidyOffer');
      } catch {
        setError("That didn't save. Try again?");
        setPhase('offered');
      } finally {
        inFlight.current = false;
      }
    },
    [sweep],
  );

  /** "None of these, thanks" — legal at any pre-commit point. Declining is free. */
  const dismiss = useCallback(async () => {
    setPhase('dismissed');
    setSweep(null);
    try {
      await dismissFoodSweep();
    } catch {
      /* the pending row outliving a failed dismiss is harmless — next week's sweep replaces it */
    }
  }, []);

  /** Re-read the week behind you — every offered proposal, one call. The diary read changes. */
  const tidy = useCallback(async () => {
    if (tidyable.length === 0 || inFlight.current) return;
    inFlight.current = true;
    setPhase('tidying');
    setError(null);
    try {
      const r = await tidyFoodSweep(tidyable.map((t) => t.proposal.id));
      setTidiedCount(r.tidied);
      setPhase('done');
      await invalidateNutritionDay();
    } catch {
      setError("That didn't go through. Try again?");
      setPhase('tidyOffer');
    } finally {
      inFlight.current = false;
    }
  }, [tidyable, invalidateNutritionDay]);

  /** The visible Undo: every sweep-tagged part comes back off. The diary read changes again. */
  const revert = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      await revertFoodTidy();
      setPhase('reverted');
      await invalidateNutritionDay();
    } catch {
      setError("That didn't go through. Try again?");
    } finally {
      inFlight.current = false;
    }
  }, [invalidateNutritionDay]);

  /** "Leave the past alone" — the flow ends with nothing tidied and nothing owed. */
  const skipTidy = useCallback(() => {
    setTidiedCount(0);
    setPhase('done');
  }, []);

  return { phase, sweep, saved, tidyable, tidiedCount, error, commit, dismiss, tidy, revert, skipTidy };
}

export type { TidyableProposal };
