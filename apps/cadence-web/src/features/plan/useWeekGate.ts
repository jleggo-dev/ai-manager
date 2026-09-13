import { useState } from 'react';
import { buildNextWeek, buildWeekAhead, type PlanOccurrence, type PlanViewData } from '../../lib/api.ts';
import { isLockedDay, lockedFromDate, wallDate } from '../today/trailLock.ts';
import { isCheckinOccurrence, isSyntheticOccurrence } from '../today/trailPreview.ts';
import { gateFor, readLaterOn, writeLaterOn, type GateVariant } from './checkinGate.ts';

/** Said when a build or a roll-forward did not land — plain, and never silent. */
const GATE_FAIL = "That didn't take — try again in a moment.";

export interface WeekGate {
  variant: GateVariant;
  day: number;
  occ: PlanOccurrence;
  date: string;
  locked: boolean;
}

/**
 * The gate, wired (owner, 2026-09-09) — everything PlanView needs to stand the wall and answer a
 * tap past the check-in, in one hook so the view stays a view:
 *
 *  - `wallAt` / `lockedFrom` — where the check-in card stands and where the lock starts
 *    (trailLock.ts), from the plan already on screen.
 *  - `tap` — the trail's `onOpen`. Asks the gate first (checkinGate.ts); a tap it lets through
 *    opens the task as before. A preview node (the projected rhythm on a locked day) is never
 *    opened: it has no row behind it.
 *  - the sheet's answers: `checkIn` (the visible send), `build` (next week, check-in untouched),
 *    `skip` (the roll-forward — "Just build my week"), `later` (quiet for the day, and the tapped
 *    activity opens), `close`.
 *
 * Called above PlanView's early returns like every other hook there; with no plan yet it holds
 * nothing and gates nothing.
 */
export function useWeekGate({
  plan,
  openTask,
  onStartCheckIn,
  onChanged,
}: {
  plan: PlanViewData | undefined;
  /** What a tap does once the gate lets it through — the task's own sheet, by shape. */
  openTask: (occ: PlanOccurrence, date: string) => void;
  onStartCheckIn: () => void;
  /** A build or a roll-forward landed — refetch the week. */
  onChanged: () => void;
}) {
  const [gate, setGate] = useState<WeekGate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayIso = plan?.week.find((d) => d.isToday)?.date ?? plan?.week[0]?.date;
  const wallAt = wallDate(plan?.weekState, todayIso);
  const lockedFrom = lockedFromDate(plan?.weekState, todayIso);

  const tap = (occ: PlanOccurrence, date: string) => {
    // The check-in's own node (owner, 2026-09-13): a tap IS the answer — start it, no prompt.
    if (isCheckinOccurrence(occ)) {
      onStartCheckIn();
      return;
    }
    const locked = isLockedDay(date, lockedFrom);
    const asked =
      todayIso && plan?.weekState
        ? gateFor({ date, locked, todayIso, weekState: plan.weekState, laterOn: readLaterOn() })
        : null;
    if (asked) {
      setError(null);
      setGate({ ...asked, occ, date, locked });
      return;
    }
    if (isSyntheticOccurrence(occ)) return;
    openTask(occ, date);
  };

  const close = () => {
    if (!busy) setGate(null);
  };
  const checkIn = () => {
    setGate(null);
    onStartCheckIn();
  };
  const later = () => {
    if (!gate) return;
    if (todayIso) writeLaterOn(todayIso);
    const { occ, date, locked } = gate;
    setGate(null);
    if (!locked && !isSyntheticOccurrence(occ)) openTask(occ, date);
  };

  async function run(call: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await call()) {
        setGate(null);
        onChanged();
      } else {
        setError(GATE_FAIL);
      }
    } catch {
      setError(GATE_FAIL);
    } finally {
      setBusy(false);
    }
  }
  const build = () =>
    void run(async () => {
      const r = await buildWeekAhead();
      return r.status === 'built' || r.status === 'already_built';
    });
  const skip = () => void run(async () => (await buildNextWeek()).status === 'committed');

  return { gate, busy, error, todayIso, wallAt, lockedFrom, tap, close, checkIn, later, build, skip };
}
