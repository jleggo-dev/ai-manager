/**
 * "Snap it" capture — Nutrition Facts label → parse-label → confirm.
 * Optional front-of-pack identify fills name/brand before the label parse.
 */
import { useState } from 'react';
import { identifyFood, parseNutritionLabel } from '../../lib/api.ts';
import { downscalePhoto } from '../plan/occurrence/format.ts';
import type { FoodDraft } from './foodDraft.ts';

export function FoodSnapPanel({ onDraft, onCancel }: { onDraft: (draft: FoodDraft) => void; onCancel: () => void }) {
  const [labelPhoto, setLabelPhoto] = useState<string | null>(null);
  const [hintName, setHintName] = useState('');
  const [hintBrand, setHintBrand] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function pickLabel(file: File | null | undefined) {
    if (!file || busy) return;
    setNote('');
    try {
      setLabelPhoto(await downscalePhoto(file));
    } catch {
      setNote("Couldn't read that photo — try a different one.");
    }
  }

  async function pickFront(file: File | null | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setNote('');
    try {
      const photo = await downscalePhoto(file);
      const id = await identifyFood(photo, hintName || undefined);
      if (id.status !== 'ok') {
        setNote(id.message);
        return;
      }
      if (id.name) setHintName(id.name);
      if (id.brand) setHintBrand(id.brand);
      setNote(
        id.name
          ? `Got it — ${id.brand ? `${id.brand} ` : ''}${id.name}. Now snap the Nutrition Facts panel.`
          : "Couldn't read a clear name — type it below, then snap the Nutrition Facts panel.",
      );
    } catch {
      setNote("Couldn't read that front photo — type the name and snap the label.");
    } finally {
      setBusy(false);
    }
  }

  async function parseLabel() {
    if (!labelPhoto || busy) return;
    setBusy(true);
    setNote('');
    try {
      const parsed = await parseNutritionLabel({
        photo: labelPhoto,
        name: hintName.trim() || undefined,
        brand: hintBrand.trim() || null,
        hint: hintName.trim() || undefined,
      });
      if (parsed.status !== 'ok') {
        setNote(parsed.message);
        return;
      }
      onDraft({
        kind: 'candidate',
        candidate: parsed.candidate,
        labelReadable: parsed.label_readable,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-panel">
      <div className="food-panel-t">Snap a label</div>
      <p className="food-panel-p">
        Point at the Nutrition Facts panel for exact macros. Optional: a front-of-pack shot for the name. You confirm
        before anything counts.
      </p>

      <div className="food-snap-fields">
        <label className="food-field">
          <span>Name (optional)</span>
          <input
            className="wiz-in"
            value={hintName}
            disabled={busy}
            onChange={(e) => setHintName(e.target.value)}
            placeholder="Filled from front photo or typing"
          />
        </label>
        <label className="food-field">
          <span>Brand (optional)</span>
          <input className="wiz-in" value={hintBrand} disabled={busy} onChange={(e) => setHintBrand(e.target.value)} />
        </label>
      </div>

      <div className="food-snap-actions">
        <label className={`food-snap-pick${busy ? ' food-snap-disabled' : ''}`}>
          Front of pack (name)
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={busy}
            onChange={(e) => {
              void pickFront(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <label className={`food-snap-pick${busy ? ' food-snap-disabled' : ''}`}>
          Nutrition Facts panel
          <input
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={busy}
            onChange={(e) => {
              void pickLabel(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {labelPhoto && (
        <div className="photo-preview food-snap-preview">
          <img src={labelPhoto} alt="nutrition label" />
          <button
            type="button"
            className="photo-clear"
            disabled={busy}
            aria-label="Remove label photo"
            onClick={() => setLabelPhoto(null)}
          >
            ×
          </button>
        </div>
      )}

      {note && <div className="food-empty">{note}</div>}

      <div className="food-confirm-actions">
        <button type="button" className="lockbtn" disabled={busy || !labelPhoto} onClick={() => void parseLabel()}>
          {busy ? 'Reading label…' : 'Read label — I confirm next'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
