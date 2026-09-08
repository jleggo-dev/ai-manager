import { useState } from 'react';
import { minutesToClock } from '../../../lib/clock.ts';
import { useClockUnit } from '../../../lib/query/index.ts';
import { QuietHoursEditor } from './QuietHoursEditor.tsx';
import { useNotificationPrefs } from './useNotificationPrefs.ts';

/**
 * The quiet-hours row in Settings: the label, and the live window under it. Tapping opens the
 * editor in place. The start of the window is also the bedtime signal the before-quiet-hours
 * nudge counts back from — that used to be a sentence here; now it is only a fact in the code
 * (owner, 2026-09-07).
 */
export function QuietHoursRow() {
  const { data: prefs } = useNotificationPrefs();
  const clock = useClockUnit();
  const [open, setOpen] = useState(false);
  if (!prefs) return null;

  return (
    <div className="quiet-row">
      <button type="button" className="set-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <b>Quiet hours</b>
        <span>
          {minutesToClock(prefs.quietStartMin, clock)}–{minutesToClock(prefs.quietEndMin, clock)}
        </span>
      </button>
      {open && <QuietHoursEditor />}
    </div>
  );
}
