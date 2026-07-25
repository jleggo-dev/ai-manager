/**
 * Barcode scan / entry (Req 5 Phase 3).
 * Camera + BarcodeDetector when available; digit entry always works.
 * Browser → OFF product-by-barcode → cadence-api import/cache. Prefer DB hits.
 */
import { useCallback, useState } from 'react';
import { lookupBarcodeFood } from '../../lib/off/lookup.ts';
import type { FoodDraft } from './foodDraft.ts';
import { useBarcodeScan } from './useBarcodeScan.ts';

export function FoodBarcodePanel({ onDraft, onCancel }: { onDraft: (draft: FoodDraft) => void; onCancel: () => void }) {
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const lookup = useCallback(
    async (raw: string) => {
      if (busy) return;
      setBusy(true);
      setNote('');
      setBarcode(raw);
      try {
        const r = await lookupBarcodeFood(raw);
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
    },
    [busy, onDraft],
  );

  const scan = useBarcodeScan((code) => {
    void lookup(code);
  });

  return (
    <div className="food-panel">
      <div className="food-panel-t">Barcode</div>
      <p className="food-empty" style={{ marginTop: 0 }}>
        {scan.supported
          ? 'Point the camera at a barcode, or type the digits. I check your saved foods first, then Open Food Facts.'
          : 'Type the digits under the barcode. I check your saved foods first, then Open Food Facts.'}
      </p>

      {scan.supported && (
        <div className="food-barcode-scan">
          <video
            ref={scan.videoRef}
            className={`food-barcode-video${scan.status === 'scanning' ? ' food-barcode-video-on' : ''}`}
            muted
            playsInline
            autoPlay
          />
          {scan.status === 'scanning' ? (
            <button type="button" className="lockbtn ghost" disabled={busy} onClick={scan.stop}>
              Stop camera
            </button>
          ) : (
            <button
              type="button"
              className="lockbtn"
              disabled={busy || scan.status === 'starting'}
              onClick={() => void scan.start()}
            >
              {scan.status === 'starting' ? 'Starting camera…' : 'Scan with camera'}
            </button>
          )}
          {(scan.statusNote || scan.status === 'denied' || scan.status === 'error') && (
            <div className="food-empty">{scan.statusNote}</div>
          )}
        </div>
      )}

      <input
        className="wiz-in food-search-in"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={!scan.supported}
        placeholder="e.g. 3017620422003"
        value={barcode}
        disabled={busy}
        onChange={(e) => setBarcode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void lookup(barcode);
        }}
      />
      {note && <div className="food-empty">{note}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="lockbtn"
          disabled={busy || !barcode.trim()}
          onClick={() => void lookup(barcode)}
        >
          {busy ? 'Looking up…' : 'Look up'}
        </button>
        <button
          type="button"
          className="lockbtn ghost"
          disabled={busy}
          onClick={() => {
            scan.stop();
            onCancel();
          }}
        >
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
