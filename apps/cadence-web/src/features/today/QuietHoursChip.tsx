import { useState } from 'react';
import { QuietHoursEditor } from '../settings/notifications/QuietHoursEditor.tsx';
import { minutesToLabel, useNotificationPrefs } from '../settings/notifications/useNotificationPrefs.ts';
import { shouldShowQuietChip } from './quietChipWindow.ts';

/**
 * `🌙 quiet at 9:30` on the Today header, from early evening.
 *
 * It appears when it is useful and disappears when it is not. A permanent chip is a setting badge;
 * one that shows up around five in the afternoon is a coach mentioning, at the hour it matters,
 * when it is going to stop talking — and giving you one tap to move that if tonight is different.
 *
 * Quiet-hours START doubles as the bedtime signal. The before-quiet-hours nudge counts backward
 * from this number, so moving it here moves that too. There is deliberately no separate bedtime
 * setting: two fields meaning the same thing is two fields that drift.
 */

export function QuietHoursChip({ now = new Date() }: { now?: Date }) {
  const { data: prefs } = useNotificationPrefs();
  const [open, setOpen] = useState(false);
  if (!prefs) return null;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (!shouldShowQuietChip(nowMinutes, prefs.quietStartMin, prefs.quietEndMin)) return null;

  // Rendered without the am/pm suffix: at 6pm, "quiet at 9:30" can only mean tonight, and the
  // suffix is two characters of noise in a chip that has to stay small.
  const label = minutesToLabel(prefs.quietStartMin).replace(/\s?(am|pm)$/, '');

  return (
    <>
      <button
        type="button"
        className="thead-pill thead-quiet"
        onClick={() => setOpen(true)}
        aria-label={`Quiet hours start at ${minutesToLabel(prefs.quietStartMin)}. Change them.`}
      >
        <span aria-hidden>🌙</span> quiet at {label}
      </button>
      {open && (
        <>
          <div className="sheet-scrim" onClick={() => setOpen(false)} aria-hidden />
          <div className="sheet quiet-sheet" role="dialog" aria-label="Quiet hours">
            <div className="sheet-grab" aria-hidden />
            <div className="sheet-head">
              <div className="sheet-title">
                <b>Quiet hours</b>
                <span>{'I treat the start as your wind-down'}</span>
              </div>
              <button className="sheet-x" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="sheet-body">
              <QuietHoursEditor />
            </div>
          </div>
        </>
      )}
    </>
  );
}
