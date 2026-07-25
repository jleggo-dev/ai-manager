/**
 * "Say it" capture — describe → estimate (or pick a search hit) → confirm.
 *
 * TODO(WS-R): swap search+estimate for POST /nutrition/foods/resolve when that
 * endpoint lands (ranked candidates + preselected serving in one round-trip).
 */
import { useState } from 'react';
import { MicButton } from '../../components/MicButton.tsx';
import { estimateFood, searchFoods, type FoodCandidate, type FoodSummary } from '../../lib/api.ts';
import { FoodRecentsList } from './FoodRecentsList.tsx';
import type { FoodDraft } from './foodDraft.ts';

export function FoodSayPanel({
  onDraft,
  onCancel,
  onPickSaved,
}: {
  onDraft: (draft: FoodDraft) => void;
  onCancel: () => void;
  onPickSaved: (summary: FoodSummary) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [hits, setHits] = useState<FoodSummary[]>([]);
  const [pending, setPending] = useState<FoodCandidate | null>(null);

  async function draftFromWords() {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote('');
    setPending(null);
    try {
      const [found, est] = await Promise.all([searchFoods(q), estimateFood(q)]);
      const matchList = found.status === 'ok' ? found.foods : [];
      setHits(matchList);

      if (est.status !== 'ok') {
        if (matchList.length) {
          setNote(`${est.message} You can still pick a match below.`);
          return;
        }
        setNote(est.message);
        return;
      }

      if (matchList.length) {
        setPending(est.candidate);
        setNote('Looks familiar — pick a match, or use the new draft I made from your words.');
        return;
      }

      onDraft({ kind: 'candidate', candidate: est.candidate });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-panel">
      <div className="food-panel-t">Say what you ate</div>
      <p className="food-panel-p">
        A few words are enough — I&apos;ll draft macros and a serving. You confirm before anything counts.
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
          <FoodRecentsList foods={hits} onPick={onPickSaved} />
        </div>
      )}
      {pending && (
        <button
          type="button"
          className="lockbtn"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => onDraft({ kind: 'candidate', candidate: pending })}
        >
          Use new draft — I confirm next
        </button>
      )}
      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy || !text.trim()} onClick={() => void draftFromWords()}>
          {busy ? 'Drafting…' : 'Draft it — I confirm next'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
