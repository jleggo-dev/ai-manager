import { useEffect, useState } from 'react';
import type { Recipe } from '@cadence/shared';
import { getCurrentMealPlan, getRecipeById, setOccurrence } from '../../lib/api.ts';
import { RecipeLogConfirm } from '../food/RecipeLogConfirm.tsx';
import { useOccurrenceDetail } from './occurrence/useOccurrenceDetail.ts';

const dishFromTitle = (title: string): string => title.replace(/^\s*cook\s+/i, '').trim() || 'dinner';

/** Find the recipe this cook task is for — by the menu day it falls on, else by dish name. */
async function resolveRecipe(date: string, dish: string): Promise<Recipe | null> {
  const plan = await getCurrentMealPlan();
  if (plan.status !== 'ok' || !plan.plan) return null;
  const byDay = plan.plan.days.find((d) => d.day === date)?.meals.find((m) => m.slot === 'dinner' && m.recipe_id);
  const byName = plan.plan.days
    .flatMap((d) => d.meals)
    .find((m) => m.recipe_name?.toLowerCase() === dish.toLowerCase());
  const recipeId = byDay?.recipe_id ?? byName?.recipe_id;
  if (!recipeId) return null;
  const detail = await getRecipeById(recipeId);
  return detail.status === 'ok' ? detail.recipe : null;
}

/**
 * The cook task (design 1A "cook → task(n steps)") — a multi-step walkthrough over the recipe's own
 * steps, ending in the SAME portion-aware confirm the Log screen's recipe tiles use —
 * `RecipeLogConfirm` (MP24). The
 * recipe carries the steps, so nothing is generated; the final step opens that confirm and ticks
 * the task once it logs. When the recipe can't be resolved (no menu that day) it degrades to a
 * plain "mark it cooked".
 *
 * MP24: this used to log `servings: recipe.servings` unconditionally — the recipe's whole BATCH
 * size, not a portion — so a 4-serving family dish landed as 4 servings in the one person logging
 * it. Routing through `RecipeLogConfirm` fixes that by construction: its own default is 1 serving,
 * adjustable before anything writes.
 */
export function CookSheet({
  occurrenceId,
  onClose,
  onLogged,
}: {
  occurrenceId: string;
  onClose: () => void;
  onLogged?: () => void;
}) {
  const { detail, setDetail, state } = useOccurrenceDetail(occurrenceId);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);

  const dish = detail ? dishFromTitle(detail.title) : '';
  const occDate = detail?.date;
  const occTitle = detail?.title;

  useEffect(() => {
    if (!occDate || !occTitle) return;
    let alive = true;
    resolveRecipe(occDate, dishFromTitle(occTitle)).then((r) => {
      if (alive) {
        setRecipe(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [occDate, occTitle]);

  const steps = recipe?.steps ?? [];
  const servings = recipe?.servings ?? 1;
  const onLast = step >= steps.length;

  /** No recipe resolved for this task — there is nothing to portion, so this just ticks the task. */
  async function markCookedOnly() {
    if (busy || !detail) return;
    setBusy(true);
    setErr('');
    try {
      await setOccurrence(detail.occurrence_id, 'done');
      setDetail({ ...detail, status: 'done' });
      onLogged?.();
      onClose();
    } catch {
      setErr("That didn't save — give it another try.");
      setBusy(false);
    }
  }

  function afterConfirmedLog() {
    setConfirming(false);
    if (!detail) return onClose();
    setDetail({ ...detail, status: 'done' });
    onLogged?.();
    onClose();
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet ss" role="dialog" aria-label="Cook">
        <div className="sheet-grab" aria-hidden />
        {state === 'loading' || loading ? (
          <div className="sheet-loading">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : !detail ? (
          <div className="sheet-msg">{"Couldn't open this just now — close and tap it again."}</div>
        ) : confirming && recipe ? (
          <RecipeLogConfirm
            recipe={recipe}
            initialMeal="dinner"
            onCancel={() => setConfirming(false)}
            onLogged={afterConfirmedLog}
          />
        ) : (
          <>
            <div className="ss-head">
              <div className="ss-disc ss-disc-meal" aria-hidden>
                <svg viewBox="0 0 24 24" width="24" height="24">
                  <path
                    d="M7 3v6M10 3v6M8.5 3v9M8.5 12v9M15.5 3c-1.5 0-2.5 1.8-2.5 4s1 4 2.5 4v9"
                    fill="none"
                    stroke="#fff"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className="ss-headt">
                <b>{recipe?.name || dish}</b>
                <span>
                  {steps.length > 0
                    ? `COOK · ${steps.length} STEP${steps.length === 1 ? '' : 'S'} · ${servings} SERVING${servings === 1 ? '' : 'S'}`
                    : `COOK · ${servings} SERVING${servings === 1 ? '' : 'S'}`}
                </span>
              </div>
            </div>

            {steps.length > 0 && !onLast ? (
              <div className="ck">
                <div className="ck-prog" aria-hidden>
                  {steps.map((_, i) => (
                    <span key={i} className={`ck-pip${i <= step ? ' is-on' : ''}`} />
                  ))}
                </div>
                <div className="ck-step-l">
                  STEP {step + 1} OF {steps.length}
                </div>
                <div className="ck-step">{steps[step]}</div>
                <div className="ck-nav">
                  {step > 0 && (
                    <button className="ck-back" onClick={() => setStep((s) => s - 1)}>
                      Back
                    </button>
                  )}
                  <button className="mc-log" onClick={() => setStep((s) => s + 1)}>
                    {step === steps.length - 1 ? 'Done — plate it up' : 'Next step'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="ck">
                {steps.length === 0 && (
                  <div className="ck-step">
                    {recipe
                      ? 'No steps saved for this one — cook it your way, then log it.'
                      : "I couldn't find this dish on your menu — mark it cooked when it's done."}
                  </div>
                )}
                {err && <div className="mc-err">{err}</div>}
                <button
                  className="mc-log"
                  disabled={busy}
                  onClick={() => (recipe ? setConfirming(true) : void markCookedOnly())}
                >
                  {busy ? 'Logging…' : recipe ? `Log ${recipe.name}` : 'Mark it cooked'}
                </button>
                {steps.length > 0 && !busy && (
                  <button className="ck-back" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                    Back to steps
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
