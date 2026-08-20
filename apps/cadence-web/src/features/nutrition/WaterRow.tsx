import { useState } from 'react';
import { logWater } from '../../lib/api.ts';

/** A glass is 250 ml — the unit the row counts in, and the amount one tap pours.
 *  Exported so the capture surfaces pour the same glass this row counts. */
export const GLASS_ML = 250;
const GLASSES = 8;

/**
 * Water on the Food home (Food Journey 02) — eight glasses, filled left to right, and a ＋.
 *
 * Deliberately the least ceremonious thing in the module: no confirm card, no estimate, no
 * provisional state. Water is the one food fact nobody has to guess at, so a tap writes it and
 * the row just fills. Optimistic by design — the count moves under the thumb and reconciles with
 * the server's own total, because a glass of water is not worth a spinner.
 *
 * Never a target and never a scold: eight glasses is the row's LENGTH, not a quota. Past eight
 * the row simply says the litres, because "count what happened" applies to water too.
 */
export function WaterRow({
  ml,
  onLogged,
  readOnly = false,
}: {
  ml: number;
  onLogged: (nextMl: number) => void;
  /** A day behind you: the row still reads, but a pour would land on today rather than on it. */
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const litres = (ml / 1000).toFixed(1);
  const filled = Math.min(GLASSES, Math.floor(ml / GLASS_ML));

  async function pour() {
    if (busy) return;
    setBusy(true);
    onLogged(ml + GLASS_ML); // optimistic — the row fills under the thumb
    try {
      const total = await logWater(GLASS_ML);
      if (total != null) onLogged(total);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fh-water">
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
        <path
          d="M12 3c4 5 6 7.6 6 10.4A6 6 0 0 1 6 13.4C6 10.6 8 8 12 3z"
          fill="none"
          stroke="oklch(58% 0.09 232)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className="fh-water-l">Water</span>
      <span className="fh-water-glasses">
        {Array.from({ length: GLASSES }, (_, i) => (
          <i key={i} className={i < filled ? 'is-full' : ''} />
        ))}
      </span>
      <span className="fh-water-v">{litres} L</span>
      {!readOnly && (
        <button className="fh-water-add" onClick={() => void pour()} disabled={busy} aria-label="Add a glass of water">
          ＋
        </button>
      )}
    </div>
  );
}
