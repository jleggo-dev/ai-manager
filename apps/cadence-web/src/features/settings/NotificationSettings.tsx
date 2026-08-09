/**
 * Settings → Notifications: the volume dial (native shell only; the seam hides this on web).
 *
 * The screen is arranged as one question and its consequences. The dial is the question. The card
 * below it is the answer, in full — including what the chosen amount leaves out, which is the part
 * that turns a setting into a promise. Quiet hours and the push switch sit underneath because they
 * are about WHEN and WHERE, not how much.
 *
 * The closing line is not reassurance decoration. It is the thing a person actually wants to know
 * before they let an app message them, and it is true at every tier: there is no broken-streak
 * alarm anywhere in the catalog, nothing that talks about falling behind, and going quiet costs
 * nothing — the freeze economy, detours and the decaying re-entry ladder all exist to make that
 * sentence something the code enforces rather than something the copy claims.
 */
import { capabilities } from '../../lib/capability/index.ts';
import { PushToggle } from './notifications/PushToggle.tsx';
import { QuietHoursRow } from './notifications/QuietHoursRow.tsx';
import { TierDial } from './notifications/TierDial.tsx';
import { TierMeansCard } from './notifications/TierMeansCard.tsx';
import { useNotificationPrefs } from './notifications/useNotificationPrefs.ts';

export function NotificationSettings() {
  // Hooks run before the early return so this component's rules-of-hooks order is stable whether
  // or not the shell is native.
  const { data: prefs, isLoading } = useNotificationPrefs();
  if (!capabilities.push.isAvailable()) return null;

  return (
    <div className="diet-block" style={{ marginTop: 12 }}>
      <div className="diet-block-t">Notifications</div>
      <div className="diet-block-h">{"I'll only say what's useful. You set how much I say."}</div>

      {isLoading || !prefs ? (
        <div className="sheet-msg" style={{ padding: '6px 0 8px' }}>
          Loading…
        </div>
      ) : (
        <>
          <TierDial />
          <TierMeansCard />
          <QuietHoursRow />
          <PushToggle />
          <p className="notif-promise">
            {
              'Whatever you pick: no broken-streak alarms, nothing about falling behind, and going quiet never costs you anything.'
            }
          </p>
        </>
      )}
    </div>
  );
}
