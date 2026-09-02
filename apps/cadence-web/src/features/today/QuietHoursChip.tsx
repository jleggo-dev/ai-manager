import { useState } from 'react';
import { createPortal } from 'react-dom';
import { minutesToClock } from '../../lib/clock.ts';
import { useClockUnit } from '../../lib/query/index.ts';
import { QuietHoursEditor } from '../settings/notifications/QuietHoursEditor.tsx';
import { useNotificationPrefs } from '../settings/notifications/useNotificationPrefs.ts';
import { useQuietChipUp } from './useQuietChipUp.ts';

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
  const clock = useClockUnit();
  const up = useQuietChipUp(now);
  const [open, setOpen] = useState(false);
  if (!prefs || !up) return null;

  // In the person's own clock (Settings → Units): "quiet at 21:00" or "quiet at 9:00". The
  // 12-hour form drops its am/pm: at 6pm, "quiet at 9:00" can only mean tonight, and the suffix
  // is two characters of noise in a chip that has to stay small.
  const spoken = minutesToClock(prefs.quietStartMin, clock);
  const label = spoken.replace(/\s?(am|pm)$/, '');

  return (
    <>
      <button
        type="button"
        className="thead-pill thead-quiet"
        onClick={() => setOpen(true)}
        aria-label={`Quiet hours start at ${spoken}. Change them.`}
      >
        <span aria-hidden>🌙</span> quiet at {label}
      </button>
      {/* Portalled out of the header, which now FLOATS over the trail: a positioned header is the
          containing block for anything absolute inside it, and `.sheet` is absolute — left here it
          would rise from the bottom edge of a 62px band instead of the bottom of the screen. The
          host is the app frame rather than the body so the desktop mockup keeps it inside the
          phone. */}
      {open &&
        createPortal(
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
          </>,
          document.querySelector('.app') ?? document.body,
        )}
    </>
  );
}
