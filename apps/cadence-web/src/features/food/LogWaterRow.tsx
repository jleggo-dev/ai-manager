import { useState } from 'react';
import { logWater } from '../../lib/api.ts';
import { GLASS_ML } from '../nutrition/WaterRow.tsx';
import { WaterIcon } from './captureIcons.tsx';

/**
 * Water, at the bottom of the Log screen, "because it is a tap, not a meal" (design 05b). One row,
 * one ＋, no confirm card — the same optimistic pour the Food home's eight-glass row makes, just
 * without the glasses, since this screen is about what you ate.
 */
export function LogWaterRow({ ml, onLogged }: { ml: number; onLogged: (nextMl: number) => void }) {
  const [busy, setBusy] = useState(false);

  async function pour() {
    if (busy) return;
    setBusy(true);
    onLogged(ml + GLASS_ML);
    try {
      const total = await logWater(GLASS_ML);
      if (total != null) onLogged(total);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="fq-row fq-row-water" disabled={busy} onClick={() => void pour()}>
      <span className="fq-water-i" aria-hidden>
        <WaterIcon />
      </span>
      <span className="fq-row-t">
        <b>Water</b>
      </span>
      <span className="fq-row-k">{(ml / 1000).toFixed(1)} L today</span>
      <span className="fq-row-add" aria-hidden>
        ＋
      </span>
    </button>
  );
}
