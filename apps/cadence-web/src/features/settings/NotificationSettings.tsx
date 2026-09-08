/**
 * Settings → Notifications (native shell only; the seam hides this on web).
 *
 * Two controls and nothing else (owner, 2026-09-07): the dial — Off / Few / Moderate / Lots — and
 * the quiet-hours window. What each amount includes and leaves out is enforced by the server's
 * tier resolution and the nudge catalog, not described here; there is no broken-streak alarm
 * anywhere in that catalog and going quiet costs nothing, and those stay true whether or not a
 * paragraph says so.
 */
import { capabilities } from '../../lib/capability/index.ts';
import { QuietHoursRow } from './notifications/QuietHoursRow.tsx';
import { TierDial } from './notifications/TierDial.tsx';
import { useNotificationPrefs } from './notifications/useNotificationPrefs.ts';

export function NotificationSettings() {
  // Hooks run before the early return so this component's rules-of-hooks order is stable whether
  // or not the shell is native.
  const { data: prefs, isLoading } = useNotificationPrefs();
  if (!capabilities.push.isAvailable()) return null;

  return (
    <div className="diet-block" style={{ marginTop: 12 }}>
      {isLoading || !prefs ? (
        <div className="sheet-msg" style={{ padding: '6px 0 8px' }}>
          Loading…
        </div>
      ) : (
        <>
          <TierDial />
          <QuietHoursRow />
        </>
      )}
    </div>
  );
}
