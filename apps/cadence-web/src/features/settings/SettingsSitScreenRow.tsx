import { useState } from 'react';
import { readSitScreen, writeSitScreen, type SitScreen } from '../../lib/sit-screen.ts';

const CHOICES: Array<{ value: SitScreen; label: string }> = [
  { value: 'dark', label: 'goes dark' },
  { value: 'on', label: 'stays on' },
];

/**
 * "Screen during a sit" (owner, 2026-11-03) — one per-device row in the Settings Room's device
 * group. Every clock the person watches holds the screen; a sit and the breath pacer hold it only
 * when this says so, because their bells ring as notifications either way. Saves on the tap, the
 * way the unit controls do: two values, instant, reversible.
 */
export function SettingsSitScreenRow() {
  const [value, setValue] = useState<SitScreen>(() => readSitScreen());

  function choose(next: SitScreen) {
    writeSitScreen(next);
    setValue(next);
  }

  return (
    <div className="room-row">
      <span className="room-row-text">
        <b>Screen during a sit</b>
        <span>The bells still ring either way.</span>
      </span>
      <span className="set-seg" role="group" aria-label="Screen during a sit">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={c.value === value ? 'set-seg-b on' : 'set-seg-b'}
            aria-pressed={c.value === value}
            onClick={() => choose(c.value)}
          >
            {c.label}
          </button>
        ))}
      </span>
    </div>
  );
}
