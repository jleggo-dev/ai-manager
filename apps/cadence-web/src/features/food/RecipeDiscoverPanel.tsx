/**
 * Optional Phase 5 recipe discovery — only mounted when the API exposes
 * POST /nutrition/recipes/discover. Picks a draft → parent confirm-saves.
 */
import { useState } from 'react';
import { discoverRecipes, recipeMacroHint, type RecipeDraft } from '../../lib/api.ts';

export function RecipeDiscoverPanel({
  onDraft,
  onCancel,
}: {
  onDraft: (draft: RecipeDraft) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [drafts, setDrafts] = useState<RecipeDraft[]>([]);
  const [notes, setNotes] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setErr('');
    setNotes(null);
    try {
      const result = await discoverRecipes(query);
      if (result.status !== 'ok') {
        setDrafts([]);
        setErr(result.message);
        return;
      }
      setDrafts(result.drafts);
      setNotes(result.notes);
      if (!result.drafts.length) {
        setErr(result.notes?.trim() || 'Nothing turned up yet — try a simpler dish name or a cuisine + protein.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-panel" role="region" aria-label="Find a real recipe">
      <div className="food-panel-t">Find a real recipe</div>
      <p className="food-panel-p">
        I&apos;ll shape a few ideas from your ask — nothing is saved until you pick one and confirm. When you like one,
        we&apos;ll keep it with your recipes.
      </p>

      <label className="food-field">
        <span>What are you craving?</span>
        <input
          className="wiz-in"
          value={query}
          disabled={busy}
          placeholder="weeknight salmon, high-protein pasta…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
        />
      </label>

      {err && <div className="food-empty">{err}</div>}
      {notes && drafts.length > 0 && <p className="food-panel-p">{notes}</p>}

      {drafts.length > 0 && (
        <ul className="food-list" aria-label="Recipe ideas">
          {drafts.map((d, i) => {
            const hint = recipeMacroHint(d.macros_per_serving);
            return (
              <li key={`${d.name}-${i}`}>
                <button type="button" className="food-row" disabled={busy} onClick={() => onDraft(d)}>
                  <b>{d.name}</b>
                  <span>
                    {d.servings} serving{d.servings === 1 ? '' : 's'}
                    {hint ? ` · ${hint}/serving` : ''}
                    {' — tap to review & save'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy || !query.trim()} onClick={() => void run()}>
          {busy ? 'Looking…' : 'Look it up'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back to recipes
        </button>
      </div>
    </div>
  );
}
