import { useState } from 'react';
import {
  scheduleUserRoutine,
  unscheduleUserRoutine,
  type UserRoutine,
  type UserRoutineDay,
  type UserRoutineSchedule,
} from '../../lib/api.ts';
import { DAY_LABEL, DAY_ORDER, joinDays } from './activityDays.ts';
import '../../styles/settings-activities.css';

const TIMES_OF_DAY: Array<{ id: NonNullable<UserRoutineSchedule['time_of_day']>; label: string }> = [
  { id: 'morning', label: 'Morning' },
  { id: 'evening', label: 'Evening' },
  { id: 'anytime', label: 'Anytime' },
];

/** The one documented failure mode for `scheduleUserRoutine` (the contract's own comment: "409
 *  when there's no active plan") — never a generic line, since the fix is different: commit a plan
 *  first, not just try again. */
const NO_PLAN = "There's no committed plan to put it on yet.";
const TRY_AGAIN = "That didn't go through — try again in a moment.";

/**
 * "Schedule it…" (Settings › Your activities, design E/F). Deterministic — day chips + a
 * time-of-day write straight onto the active plan, no generation anywhere in this path. Already
 * scheduled shows the current days and offers "Take it off the plan" instead of asking the day
 * chips over again.
 */
export function ActivityScheduleSheet({
  routine,
  onClose,
  onDone,
}: {
  routine: UserRoutine;
  onClose: () => void;
  /** Fires only after a write that actually went through — the parent uses it to update the row
   *  and close the sheet. `null` means "no longer scheduled". */
  onDone: (schedule: UserRoutineSchedule | null) => void;
}) {
  const [days, setDays] = useState<Set<UserRoutineDay>>(new Set(routine.schedule?.days ?? []));
  const [timeOfDay, setTimeOfDay] = useState<NonNullable<UserRoutineSchedule['time_of_day']>>(
    routine.schedule?.time_of_day ?? 'anytime',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function toggleDay(d: UserRoutineDay) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  async function put() {
    const chosen = DAY_ORDER.filter((d) => days.has(d));
    if (chosen.length === 0) return;
    setBusy(true);
    setErr('');
    const schedule: UserRoutineSchedule = { days: chosen, time_of_day: timeOfDay };
    const { ok } = await scheduleUserRoutine(routine.routine_id, schedule);
    setBusy(false);
    if (ok) onDone(schedule);
    else setErr(NO_PLAN);
  }

  async function takeOff() {
    setBusy(true);
    setErr('');
    const { ok } = await unscheduleUserRoutine(routine.routine_id);
    setBusy(false);
    if (ok) onDone(null);
    else setErr(TRY_AGAIN);
  }

  const alreadyOn = !!routine.schedule && routine.schedule.days.length > 0;

  return (
    <div className="se-confirm-scrim" onClick={busy ? undefined : onClose}>
      <div
        className="se-confirm-card"
        role="dialog"
        aria-label={`Schedule ${routine.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="se-confirm-t">Put &quot;{routine.name}&quot; on the plan</div>
        {alreadyOn && (
          <div className="sa-current">
            {`Currently on the plan ${joinDays(routine.schedule!.days)}`}
            {routine.schedule!.time_of_day ? ` · ${routine.schedule!.time_of_day}` : ''}.
          </div>
        )}

        <div className="sa-sheet-body">
          <div>
            <div className="sa-chip-label">Days</div>
            <div className="sa-day-row">
              {DAY_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`sa-chip${days.has(d) ? ' sa-active' : ''}`}
                  aria-pressed={days.has(d)}
                  disabled={busy}
                  onClick={() => toggleDay(d)}
                >
                  {DAY_LABEL[d]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="sa-chip-label">Time of day</div>
            <div className="sa-tod-row">
              {TIMES_OF_DAY.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`sa-chip${timeOfDay === t.id ? ' sa-active' : ''}`}
                  aria-pressed={timeOfDay === t.id}
                  disabled={busy}
                  onClick={() => setTimeOfDay(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {err && <div className="se-note">{err}</div>}

        <div className="sa-sheet-actions">
          <button
            type="button"
            className="sa-primary-btn"
            disabled={busy || days.size === 0}
            onClick={() => void put()}
          >
            {busy ? 'Saving…' : alreadyOn ? 'Update' : 'Put it on the plan'}
          </button>
          {alreadyOn && (
            <button type="button" className="sa-unschedule-btn" disabled={busy} onClick={() => void takeOff()}>
              Take it off the plan
            </button>
          )}
          <button type="button" className="sa-cancel-btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
