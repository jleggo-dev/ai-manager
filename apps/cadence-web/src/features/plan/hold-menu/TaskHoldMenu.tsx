import { useState } from 'react';
import type { PlanActivity, PlanDay, PlanOccurrence } from '../../../lib/api.ts';
import { dayChoices, dayName, doNowStep, holdActions, type DoNowStep } from './holdMenuModel.ts';

export type HoldScreen = 'menu' | 'move' | 'copy' | 'delete' | 'do-now' | 'do-now-sure';

/**
 * The sheet a held trail node opens (owner, 2026-09-07): do it now · move · copy · take it off.
 * Every rule it obeys lives in holdMenuModel.ts; this component only draws the screen the
 * router names and reports the tap. The confirms are its own screens rather than dialogs, so
 * the sheet never stacks (popup discipline: one Cadence moment on screen at a time).
 *
 * `initialScreen` lets the future-task preview jump straight to the "do it now" ask — the
 * preview's one door leads here, and the ask must be the same ask either way.
 */
export function TaskHoldMenu({
  occ,
  date,
  todayIso,
  week,
  activities,
  busy,
  error,
  initialScreen = 'menu',
  onClose,
  onMove,
  onDuplicate,
  onDelete,
  onDoNow,
  onOpen,
}: {
  occ: PlanOccurrence;
  /** The day the held node sits on. */
  date: string;
  todayIso: string;
  /** This week as the trail draws it — today through the horizon. Earlier weeks are not offered. */
  week: readonly PlanDay[];
  activities: readonly Pick<PlanActivity, 'activity_id' | 'recurrence'>[];
  busy: boolean;
  error: string | null;
  initialScreen?: HoldScreen;
  onClose: () => void;
  onMove: (date: string) => void;
  onDuplicate: (date: string) => void;
  onDelete: () => void;
  /** Move this task onto today, then open it. */
  onDoNow: () => void;
  /** Open a task's own sheet — today's row itself, or its twin already sitting on today. */
  onOpen: (occurrenceId: string) => void;
}) {
  const [screen, setScreen] = useState<HoldScreen>(initialScreen);
  const here = dayName(date, week, todayIso);
  const actions = holdActions(
    occ,
    date,
    week.map((d) => d.date),
  );
  const step: DoNowStep = doNowStep(occ, date, todayIso, week, activities);

  function doNow() {
    if (step.kind === 'open') return onOpen(occ.occurrence_id);
    setScreen('do-now');
  }

  /** The "move it to today" confirm: an every-day task asks once more; otherwise it goes. */
  function confirmMove() {
    if (step.kind === 'ask_move' && step.everyDay) return setScreen('do-now-sure');
    finishDoNow();
  }

  /** The last word: today's own row wins when there is one (a day holds a task once). */
  function finishDoNow() {
    if (step.kind === 'ask_move' && step.twin) return onOpen(step.twin.occurrence_id);
    onDoNow();
  }

  const twin = step.kind === 'ask_move' ? step.twin : null;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet hm" role="dialog" aria-label={`${occ.title} — options`}>
        <div className="sheet-grab" aria-hidden />

        {screen === 'menu' && (
          <>
            <div className="hm-h">
              <b>{occ.title}</b>
              <span>{here}</span>
            </div>
            {actions.includes('do_now') && (
              <button className="hm-row" onClick={doNow} disabled={busy}>
                <b>Do it now</b>
                {step.kind === 'ask_move' && <span>{"I'll move it to today first."}</span>}
              </button>
            )}
            <button className="hm-row" onClick={() => setScreen('move')} disabled={busy}>
              <b>Move to another day</b>
            </button>
            <button className="hm-row" onClick={() => setScreen('copy')} disabled={busy}>
              <b>Copy to another day</b>
            </button>
            <button className="hm-row is-danger" onClick={() => setScreen('delete')} disabled={busy}>
              <b>Take it off the plan</b>
            </button>
          </>
        )}

        {(screen === 'move' || screen === 'copy') && (
          <DayPicker
            title={screen === 'move' ? `Move ${occ.title} to…` : `Copy ${occ.title} to…`}
            choices={dayChoices(week, occ, todayIso)}
            busy={busy}
            onPick={screen === 'move' ? onMove : onDuplicate}
          />
        )}

        {screen === 'delete' && (
          <>
            <div className="hm-h">
              <b>
                Take {occ.title} off {here}?
              </b>
              <span>{"It just comes off the plan — nothing you've logged is touched."}</span>
            </div>
            <div className="hm-actions">
              <button className="ss-btn hm-danger" onClick={onDelete} disabled={busy}>
                {busy ? 'One moment…' : 'Take it off'}
              </button>
            </div>
          </>
        )}

        {screen === 'do-now' && (
          <>
            <div className="hm-h">
              <b>
                {occ.title} is on {here}.
              </b>
              <span>
                {twin
                  ? `Today already has its own ${occ.title} — I'll open today's instead.`
                  : 'Move it to today and do it now?'}
              </span>
            </div>
            <div className="hm-actions">
              <button className="ss-btn ss-start" onClick={confirmMove} disabled={busy}>
                {busy ? 'One moment…' : twin ? "Open today's" : 'Move it to today'}
              </button>
            </div>
          </>
        )}

        {screen === 'do-now-sure' && (
          <>
            <div className="hm-h">
              <b>{occ.title} comes round every day.</b>
              <span>
                {twin
                  ? `${here}'s stays where it is and today's opens now. Sure?`
                  : `Moving ${here}'s leaves ${here} without one. Sure?`}
              </span>
            </div>
            <div className="hm-actions">
              <button className="ss-btn ss-start" onClick={finishDoNow} disabled={busy}>
                {busy ? 'One moment…' : "Yes, I'm sure"}
              </button>
            </div>
          </>
        )}

        {error && (
          <p className="hm-err" role="alert">
            {error}
          </p>
        )}

        {screen === 'menu' ? (
          <button className="adhoc-cancel" onClick={onClose}>
            Cancel
          </button>
        ) : (
          <button className="adhoc-cancel" onClick={() => setScreen('menu')} disabled={busy}>
            Back
          </button>
        )}
      </div>
    </>
  );
}

function DayPicker({
  title,
  choices,
  busy,
  onPick,
}: {
  title: string;
  choices: ReturnType<typeof dayChoices>;
  busy: boolean;
  onPick: (date: string) => void;
}) {
  return (
    <>
      <div className="hm-h">
        <b>{title}</b>
        <span>Any day this week.</span>
      </div>
      <div className="hm-days">
        {choices.map((c) => (
          <button key={c.date} className="hm-day" onClick={() => onPick(c.date)} disabled={busy || c.taken}>
            <b>{c.label}</b>
            {c.taken && <span>already here</span>}
          </button>
        ))}
      </div>
    </>
  );
}
