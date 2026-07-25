/**
 * Confirm-first dietary profile update from coach chat (Req 5 WS5).
 * Nothing is saved until the user taps confirm.
 */
import { useState } from 'react';
import type { DietaryProfile } from '@cadence/shared';
import { saveDietaryProfile } from '../../lib/api.ts';

function line(label: string, values: string[]): string | null {
  if (!values.length) return null;
  return `${label}: ${values.join(', ')}`;
}

export function CoachDietaryConfirm({
  proposed,
  onCancel,
  onSaved,
}: {
  proposed: DietaryProfile;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const summary = [
    line('Allergies', proposed.allergies),
    proposed.diet ? `Diet: ${proposed.diet}` : null,
    line('Soft avoids', proposed.dislikes),
    proposed.notes?.trim() ? `Notes: ${proposed.notes.trim()}` : null,
  ].filter(Boolean);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const saved = await saveDietaryProfile(proposed);
      if (!saved) {
        setErr("Couldn't save that just now — try again, or update it in Settings.");
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-confirm" role="region" aria-label="Confirm dietary update">
      <div className="food-panel-t">Update what we work around?</div>
      <p className="food-panel-p">
        Here&apos;s what I heard — nothing changes until you confirm. Allergies stay hard excludes for suggestions.
      </p>
      <ul className="coach-food-summary">
        {summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      {err && <div className="food-empty">{err}</div>}
      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy} onClick={() => void confirm()}>
          {busy ? 'Saving…' : 'Looks right — update'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Not now
        </button>
      </div>
    </div>
  );
}
