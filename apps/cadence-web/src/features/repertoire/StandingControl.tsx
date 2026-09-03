import { useState } from 'react';
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import { patchRepertoireItem } from '../../lib/api/repertoire-item.ts';
import { STANDING_EXPLANATION, STANDING_ORDER, STANDING_WORDS } from './repertoireItemCopy.ts';

export interface StandingControlProps {
  itemId: string;
  status: RepertoireStatus;
  /** Called with the fresh row once a standing change is confirmed. */
  onChanged: (item: RepertoireItem) => void;
}

/**
 * WHERE IT STANDS — the four-way Up next / Learning / Keeping up / Learned control. Acts
 * immediately (no separate save step, unlike the name fields above it): tapping a standing posts
 * it right away, same as the brief's "the standing control... act[s] immediately".
 *
 * Shows the tapped standing's own word right away (optimistic) so the control never looks like it
 * ignored the tap, and reverts to the last-confirmed standing if the write fails — never leaves
 * the screen claiming a standing the server did not actually record.
 */
export function StandingControl({ itemId, status, onChanged }: StandingControlProps) {
  const [current, setCurrent] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function choose(next: RepertoireStatus) {
    if (busy || next === current) return;
    const previous = current;
    setCurrent(next);
    setBusy(true);
    setError('');
    try {
      const saved = await patchRepertoireItem(itemId, { status: next });
      onChanged(saved);
    } catch (err) {
      setCurrent(previous);
      setError(err instanceof Error ? err.message : 'That did not save — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pw-card">
      <div className="pw-sect">
        <span>Where it stands</span>
      </div>
      <div className="pw-seg" role="group" aria-label="Standing">
        {STANDING_ORDER.map((word) => (
          <button
            key={word}
            type="button"
            className={word === current ? 'pw-seg-btn pw-seg-on' : 'pw-seg-btn'}
            aria-pressed={word === current}
            disabled={busy}
            onClick={() => void choose(word)}
          >
            {STANDING_WORDS[word]}
          </button>
        ))}
      </div>
      <div className="ri-standing-note">{STANDING_EXPLANATION[current]}</div>
      {error && <div className="ri-standing-err">{error}</div>}
    </div>
  );
}
