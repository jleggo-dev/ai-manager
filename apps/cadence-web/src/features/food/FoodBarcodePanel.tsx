/**
 * Barcode entry stub (Req 5 Phase 3) — type a barcode for now; camera scan later.
 * Browser → OFF product-by-barcode → cadence-api import/cache. Prefer DB hits.
 */
import { useState } from 'react';
import { lookupBarcodeFood } from '../../lib/off/lookup.ts';
import type { FoodDraft } from './foodDraft.ts';

export function FoodBarcodePanel({ onDraft, onCancel }: { onDraft: (draft: FoodDraft) => void; onCancel: () => void }) {
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function lookup() {
    if (busy) return;
    setBusy(true);
    setNote('');
    try {
      const r = await lookupBarcodeFood(barcode);
      if (r.status === 'not_found') {
        setNote('No product for that barcode yet — snap the Nutrition Facts panel instead.');
        return;
      }
      if (r.status !== 'ok') {
        setNote(r.message);
        return;
      }
      onDraft({ kind: 'saved', food: r.food });
    } catch {
      setNote("Couldn't look that up just now — try again, or snap the label.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="food-panel">
      <div className="food-panel-t">Barcode</div>
      <p className="food-empty" style={{ marginTop: 0 }}>
        Type the digits under the barcode for now — camera scan comes later. I check your saved foods first, then Open
        Food Facts.
      </p>
      <input
        className="wiz-in food-search-in"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        placeholder="e.g. 3017620422003"
        value={barcode}
        disabled={busy}
        onChange={(e) => setBarcode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void lookup();
        }}
      />
      {note && <div className="food-empty">{note}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button type="button" className="lockbtn" disabled={busy || !barcode.trim()} onClick={() => void lookup()}>
          {busy ? 'Looking up…' : 'Look up'}
        </button>
        <button type="button" className="lockbtn ghost" disabled={busy} onClick={onCancel}>
          Back
        </button>
      </div>
      <p className="food-empty" style={{ fontSize: 12, marginTop: 12 }}>
        Product data © Open Food Facts contributors —{' '}
        <a href="https://opendatacommons.org/licenses/odbl/" target="_blank" rel="noreferrer">
          ODbL
        </a>
        .
      </p>
    </div>
  );
}
