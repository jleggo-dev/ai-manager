import { useEffect, useState } from 'react';
import { readProgressLine, type ReadProgressStep } from '@cadence/shared';
import { generateMealPlan, mealPlanDayLabel, shoppingListSummary, type MealPlanDraft } from '../../lib/api.ts';

/**
 * Drafting a week takes ~85s (measured 2026-09-03, broker profile) — same ruling as the photo
 * read and the session prep: don't hide the wait, narrate it, and be specific. The tail line
 * HOLDS however long it runs.
 */
const DRAFT_WEEK_STEPS: ReadProgressStep[] = [
  { at: 0, text: 'Reading what you like and what we work around…' },
  { at: 8000, text: 'Sketching the week, dinner first…' },
  { at: 25000, text: 'Balancing the days against your targets…' },
  { at: 45000, text: 'Writing out each meal…' },
  { at: 70000, text: 'Putting the shopping list together…' },
  { at: 95000, text: 'Nearly there — checking the week reads right…' },
];

/**
 * Draft this week — AI week-drafting, back in the Kitchen (owner ruling 2026-09-02: "that is
 * supposed to be in the kitchen"). The old July panel's flow, redrawn in the Kitchen's own idiom:
 * an optional note, one Draft call, a review of the days it proposes, and nothing sticks until
 * "Keep this week". Keeping over an existing week replaces it, and the card says so first.
 */
export function KitchenDraftWeek({
  weekOf,
  hasPlan,
  busy,
  onKeep,
  onCancel,
}: {
  weekOf: string;
  /** A week already planned — keeping the draft will replace it, and the copy must say so. */
  hasPlan: boolean;
  busy: boolean;
  onKeep: (draft: MealPlanDraft) => void;
  onCancel: () => void;
}) {
  const [prefs, setPrefs] = useState('');
  const [draft, setDraft] = useState<MealPlanDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!drafting) return;
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Date.now() - t0), 1000);
    return () => clearInterval(tick);
  }, [drafting]);

  async function run() {
    if (drafting) return;
    setDrafting(true);
    setErr('');
    try {
      const r = await generateMealPlan({ week_of: weekOf, ...(prefs.trim() ? { prefs: prefs.trim() } : {}) });
      if (r.status !== 'ok') return setErr(r.message);
      setDraft(r.draft);
    } finally {
      setDrafting(false);
    }
  }

  if (draft) {
    return (
      <div className="kt-plan" role="region" aria-label="The drafted week">
        <button className="kt-linkback" onClick={() => setDraft(null)}>
          ‹ Try a different note
        </button>
        <b className="kt-plan-t">Here&apos;s the week I&apos;d cook — keep it?</b>
        {draft.days.map((d) => (
          <div className="kt-row" key={d.day}>
            <span className="kt-row-t">
              <b>{mealPlanDayLabel(d.day)}</b>
              <span>{d.meals.map((m) => `${m.slot}: ${m.recipe.name}`).join(' · ')}</span>
            </span>
          </div>
        ))}
        <div className="kt-count">{shoppingListSummary(draft.shopping_list)}</div>
        {hasPlan && <div className="kt-note">Keeping this replaces what&apos;s planned for the week.</div>}
        {err && <div className="kt-note">{err}</div>}
        <button className="kt-primary" disabled={busy} onClick={() => onKeep(draft)}>
          Keep this week <i aria-hidden>›</i>
        </button>
      </div>
    );
  }

  return (
    <div className="kt-plan" role="region" aria-label="Draft this week">
      <button className="kt-linkback" onClick={onCancel}>
        ‹ The week
      </button>
      <b className="kt-plan-t">Draft this week</b>
      <p className="kt-lede">
        A week of dinners you&apos;d like, with a shopping list to match — nothing sticks until you keep it.
      </p>
      <label className="kt-field">
        <span>Anything I should work around?</span>
        <textarea
          className="kt-field-in"
          rows={3}
          value={prefs}
          disabled={drafting}
          placeholder="Busy Wednesdays, more fish, use the chili we saved…"
          onChange={(e) => setPrefs(e.target.value)}
        />
      </label>
      {err && <div className="kt-note">{err}</div>}
      {drafting && <div className="kt-count">{readProgressLine(DRAFT_WEEK_STEPS, elapsed)}</div>}
      <button className="kt-primary" disabled={drafting} onClick={() => void run()}>
        {drafting ? 'Drafting…' : 'Draft the week'} <i aria-hidden>›</i>
      </button>
    </div>
  );
}
