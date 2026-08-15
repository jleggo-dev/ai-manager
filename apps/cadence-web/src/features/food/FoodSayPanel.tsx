/**
 * "Say it" capture — resolve → confirm (preselect when clear), or estimate for "new".
 * Snap/parse-label stays on FoodSnapPanel; nothing logs until portion confirm.
 */
import { useState } from 'react';
import { MicButton } from '../../components/MicButton.tsx';
import {
  estimateFood,
  getPlateAdvice,
  previewMeal,
  type MealPreview,
  type PlateAdvice,
  foodSummaryFromResolve,
  portionHintFromResolve,
  resolveFoods,
  type FoodSummary,
  type ResolveCandidate,
  type ResolvePortionHint,
} from '../../lib/api.ts';
import { FoodRecentsList } from './FoodRecentsList.tsx';
import { MealParseCard } from './MealParseCard.tsx';
import { looksLikeMultiItemMeal } from './mealShape.ts';
import type { FoodDraft } from './foodDraft.ts';

export function FoodSayPanel({
  onDraft,
  onCancel,
  onPickSaved,
}: {
  onDraft: (draft: FoodDraft) => void;
  onCancel: () => void;
  onPickSaved: (summary: FoodSummary, portion?: ResolvePortionHint) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [hits, setHits] = useState<FoodSummary[]>([]);
  const [portionById, setPortionById] = useState<Record<string, ResolvePortionHint>>({});
  const [newHint, setNewHint] = useState<ResolveCandidate | null>(null);
  const [mealPreview, setMealPreview] = useState<MealPreview | null>(null);
  const [advice, setAdvice] = useState<PlateAdvice | null>(null);
  const [advising, setAdvising] = useState(false);

  async function draftNewFromWords(q: string, captureText?: string) {
    const est = await estimateFood(captureText?.trim() || q);
    if (est.status !== 'ok') {
      setNote(est.message);
      return;
    }
    onDraft({ kind: 'candidate', candidate: est.candidate });
  }

  async function draftFromWords(opts?: { forceSingle?: boolean }) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote('');
    setHits([]);
    setPortionById({});
    setNewHint(null);
    try {
      // A multi-ingredient description goes to the meal parser — the quantities in the text ARE
      // the servings, so the single-food portion question would ask what was already answered.
      if (!opts?.forceSingle && looksLikeMultiItemMeal(q)) {
        try {
          const p = await previewMeal(q);
          if (p.items.length >= 2) {
            setMealPreview(p);
            return;
          }
        } catch {
          /* preview unavailable — the resolver still works */
        }
      }
      const resolved = await resolveFoods({ text: q });

      // Deploy lag / hard fail — fall back to estimate so say still works.
      if (resolved.status !== 'ok') {
        await draftNewFromWords(q);
        return;
      }

      const foodCandidates = resolved.candidates.filter((c) => c.kind === 'food' && c.food_id);
      const newCand = resolved.candidates.find((c) => c.kind === 'new') ?? null;
      const portions: Record<string, ResolvePortionHint> = {};
      for (const c of foodCandidates) {
        if (c.food_id) portions[c.food_id] = portionHintFromResolve(c);
      }
      setPortionById(portions);

      const clearBest = resolved.preselected?.food_id ? resolved.preselected : null;
      if (clearBest?.food_id) {
        const summary = foodSummaryFromResolve(clearBest);
        if (summary) {
          onPickSaved(summary, portionHintFromResolve(clearBest));
          return;
        }
      }

      if (foodCandidates.length) {
        const summaries: FoodSummary[] = [];
        for (const c of foodCandidates) {
          const s = foodSummaryFromResolve(c);
          if (s) summaries.push(s);
        }
        setHits(summaries);
        setNewHint(newCand);
        setNote(
          summaries.length > 1
            ? 'A few close matches — pick one, or add it as new. Nothing counts until you confirm.'
            : "Here's a match — pick it, or add as new. You confirm before anything counts.",
        );
        return;
      }

      // No saved match → "new" capture (estimate).
      await draftNewFromWords(q, newCand?.capture?.text);
    } finally {
      setBusy(false);
    }
  }

  if (mealPreview) {
    return (
      <MealParseCard
        preview={mealPreview}
        onAskRead={() => {
          setAdvising(true);
          void getPlateAdvice({ meal: mealPreview.raw_text })
            .then((a) => setAdvice(a))
            .finally(() => setAdvising(false));
        }}
        advice={advice}
        advising={advising}
        onLogged={() => {
          setMealPreview(null);
          setText('');
          onCancel();
        }}
        onNotAMeal={() => {
          setMealPreview(null);
          void draftFromWords({ forceSingle: true });
        }}
        onCancel={() => setMealPreview(null)}
      />
    );
  }

  return (
    <div className="food-panel">
      <div className="food-panel-t">Say what you ate</div>
      <p className="food-panel-p">
        A few words are enough — I&apos;ll match your foods or draft a new one. You confirm before anything counts.
      </p>
      <div className="food-say-row">
        <textarea
          className="logbox-in food-say-in"
          value={text}
          rows={2}
          disabled={busy}
          placeholder='e.g. "nonfat greek yogurt, 170g" or "turkey chili bowl"'
          onChange={(e) => setText(e.target.value)}
        />
        <MicButton value={text} onChange={setText} disabled={busy} />
      </div>
      {note && <div className="food-empty">{note}</div>}
      {hits.length > 0 && (
        <div className="food-say-hits">
          <div className="plan-week-label">Matches</div>
          <FoodRecentsList foods={hits} onPick={(s) => onPickSaved(s, portionById[s.food_id])} />
        </div>
      )}
      {newHint && (
        <button
          type="button"
          className="lockbtn"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setNote('');
              try {
                await draftNewFromWords(text.trim(), newHint.capture?.text);
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          Add as new — I confirm next
        </button>
      )}
      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy || !text.trim()} onClick={() => void draftFromWords()}>
          {busy ? 'Matching…' : 'Match it — I confirm next'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
