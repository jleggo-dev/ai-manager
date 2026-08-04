import { useState } from 'react';
import {
  FREE_WRITE_COMMITMENT,
  FREE_WRITE_PRESETS,
  clampFreeWriteMinutes,
  freeWriteDurationChip,
  freeWritePickerHead,
  freeWriteRows,
  type FreeWriteSurface,
} from '@cadence/shared';

export interface FreeWriteStartChoice {
  minutes: number;
  prompt: string;
  surface: FreeWriteSurface;
}

/**
 * The sheet that begins a timed free-write (Design "Journal v2" §1b) — the same picker and the
 * same pill as an ordinary question, **not a new mode**.
 *
 * Three rules from the redlines, visible in the markup:
 *
 *   • **The pure free-write pins to the top** and needs no coach input, so a timed write is always
 *     reachable. Coach-proposed topics sit under it; with none, the sheet is still complete.
 *   • **Pressing a row starts the timer** — the press IS the commitment, stated plainly in the
 *     footer. There is no untimed path in from here; dismissing starts nothing.
 *   • The duration is one value for the whole session. The coach's wins when it sent one;
 *     otherwise the reader picks it (owner, 2026-08-04), because sitting down for twenty minutes
 *     is not something anyone needs prescribed.
 *
 * The surface toggle is the owner's paper case: the same timed write, but the words go in a
 * physical notebook and this app is only the clock.
 */
export function FreeWriteStart({
  coachMinutes,
  topics,
  onStart,
  onClose,
}: {
  /** Set when the coach issued a duration; the reader then has no picker to argue with. */
  coachMinutes?: number;
  topics?: readonly { label: string; prompt: string }[];
  onStart: (choice: FreeWriteStartChoice) => void;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState(() => clampFreeWriteMinutes(coachMinutes));
  const [surface, setSurface] = useState<FreeWriteSurface>('typed');
  const rows = freeWriteRows(topics);

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet fw-start" role="dialog" aria-label="Start a timed free-write">
        <div className="sheet-grab" aria-hidden />

        <div className="fw-head">
          <b className="jw-picker-head">{freeWritePickerHead(minutes)}</b>
          <span className="fw-chip">{freeWriteDurationChip(minutes)}</span>
        </div>

        {/* Only when the coach didn't decide — otherwise the duration is simply the session's. */}
        {coachMinutes === undefined && (
          <div className="fw-durations" role="group" aria-label="How long">
            {FREE_WRITE_PRESETS.map((m) => (
              <button
                key={m}
                className={`fw-dur ${m === minutes ? 'on' : ''}`}
                aria-pressed={m === minutes}
                onClick={() => setMinutes(m)}
              >
                {m} min
              </button>
            ))}
          </div>
        )}

        <div className="fw-surface" role="group" aria-label="Where you're writing">
          <button
            className={`fw-surf ${surface === 'typed' ? 'on' : ''}`}
            aria-pressed={surface === 'typed'}
            onClick={() => setSurface('typed')}
          >
            Here
          </button>
          <button
            className={`fw-surf ${surface === 'paper' ? 'on' : ''}`}
            aria-pressed={surface === 'paper'}
            onClick={() => setSurface('paper')}
          >
            On paper
          </button>
        </div>

        {rows.map((r) => (
          <button
            key={r.id ?? 'pure'}
            className={`jw-bank ${r.id === null ? 'fw-pure' : ''}`}
            onClick={() => onStart({ minutes, prompt: r.prompt, surface })}
          >
            <span>{r.label.toUpperCase()}</span>
            <em>{r.prompt}</em>
          </button>
        ))}

        <div className="fw-commit">{FREE_WRITE_COMMITMENT}</div>
      </div>
    </>
  );
}
