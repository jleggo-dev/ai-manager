/**
 * Stub "structure from text" — POST /nutrition/recipes/from-chat → confirm save.
 * Coach mid-chat "save that as a recipe" can reuse the same API later.
 */
import { useState } from 'react';
import { MicButton } from '../../components/MicButton.tsx';
import { structureRecipeFromChat, type RecipeDraft } from '../../lib/api.ts';

export function RecipeFromChatPanel({
  onDraft,
  onCancel,
}: {
  onDraft: (draft: RecipeDraft) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function structure() {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setNote('');
    try {
      const r = await structureRecipeFromChat(q);
      if (r.status !== 'ok') {
        setNote(r.message);
        return;
      }
      onDraft(r.draft);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-panel" role="region" aria-label="Structure recipe from text">
      <div className="food-panel-t">Structure a recipe</div>
      <p className="food-panel-p">
        Tell me what you made — ingredients and how many it serves. I&apos;ll draft it; you confirm before anything is
        saved.
      </p>
      <div className="food-say-row">
        <textarea
          className="wiz-in food-say-in"
          rows={3}
          value={text}
          disabled={busy}
          placeholder="chili with 500g beef, 2 cans beans, onion, makes 6 bowls"
          onChange={(e) => setText(e.target.value)}
        />
        <MicButton value={text} onChange={setText} disabled={busy} />
      </div>
      {note && <div className="food-empty">{note}</div>}
      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy || !text.trim()} onClick={() => void structure()}>
          {busy ? 'Drafting…' : 'Draft recipe'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
