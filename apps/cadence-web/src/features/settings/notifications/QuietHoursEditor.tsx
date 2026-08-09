import {
  minutesToTimeValue,
  timeValueToMinutes,
  useNotificationPrefs,
  useSaveNotificationPrefs,
} from './useNotificationPrefs.ts';

/**
 * The two ends of the quiet window.
 *
 * Its own component because two surfaces open it — the Settings row and the quiet-hours chip on
 * Today — and a second copy is how the chip and the row start disagreeing about what a bedtime is.
 *
 * The start is not just "stop notifying". It is the bedtime signal the whole product uses: the
 * before-quiet-hours nudge counts backward from it, so winding down earlier moves that nudge
 * earlier without anyone having to keep two settings in step. There is deliberately no separate
 * "bedtime" field to forget to update.
 */
export function QuietHoursEditor() {
  const { data: prefs } = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  if (!prefs) return null;

  return (
    <div className="quiet-edit">
      <label className="quiet-edit-field">
        <span>Wind down at</span>
        <input
          type="time"
          value={minutesToTimeValue(prefs.quietStartMin)}
          disabled={save.isPending}
          onChange={(e) => {
            const min = timeValueToMinutes(e.target.value);
            if (min !== null) save.mutate({ quietStartMin: min });
          }}
        />
      </label>
      <label className="quiet-edit-field">
        <span>Back at</span>
        <input
          type="time"
          value={minutesToTimeValue(prefs.quietEndMin)}
          disabled={save.isPending}
          onChange={(e) => {
            const min = timeValueToMinutes(e.target.value);
            if (min !== null) save.mutate({ quietEndMin: min });
          }}
        />
      </label>
      <p className="quiet-edit-note">
        {
          'Nothing reaches you between these — not a reminder, not a check-in, nothing. If you set both the same, there are no quiet hours at all.'
        }
      </p>
    </div>
  );
}
