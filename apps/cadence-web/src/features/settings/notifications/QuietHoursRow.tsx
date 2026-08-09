import { useState } from 'react';
import { QuietHoursEditor } from './QuietHoursEditor.tsx';
import { minutesToLabel, useNotificationPrefs } from './useNotificationPrefs.ts';

/**
 * The quiet-hours row in Settings: the window, and what the start of it means.
 *
 * The subtitle earns its place. "I treat the start as your wind-down" is the difference between a
 * user setting 9:30 to mean "stop buzzing me" and understanding that everything else in the app
 * counts backward from it too. Without that sentence the before-quiet-hours nudge arrives as a
 * surprise from a setting they thought only silenced things.
 */
export function QuietHoursRow() {
  const { data: prefs } = useNotificationPrefs();
  const [open, setOpen] = useState(false);
  if (!prefs) return null;

  return (
    <div className="quiet-row">
      <button type="button" className="set-row" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <b>
          Quiet hours · {minutesToLabel(prefs.quietStartMin)} to {minutesToLabel(prefs.quietEndMin)}
        </b>
        <span>{'I treat the start as your wind-down'}</span>
      </button>
      {open && <QuietHoursEditor />}
    </div>
  );
}
