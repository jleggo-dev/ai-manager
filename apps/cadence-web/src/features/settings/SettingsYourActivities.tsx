/**
 * Settings Room — "Your activities" (Activity Builder wave 3, W3-3): manage what you've built.
 * Mounted beside `SettingsGoals` (design D: "on Settings' own row grammar — it sits beside the
 * goals section, which already does rename/retire this way"). Standalone, same shape as
 * `SettingsGoals`: fetches its own data via `listUserRoutines()` and takes only
 * `onBack`/`onEditRoutine` — nothing here is passed down from `SettingsRoom`.
 *
 * "The coach can schedule them, never edit them" (design D) is a real seam, not just copy: Edit
 * steps hands off to the builder parcel through the `onEditRoutine` prop, which this file never
 * imports directly — absent, the menu item simply doesn't render. Delete is a LIGHT confirm, not
 * the typed danger-zone ritual: logged history survives it (`runs` stays a fact forever), so the
 * stakes are low and the copy says why.
 */
import { useEffect, useState } from 'react';
import { deriveWalkthrough } from '@cadence/shared';
import {
  createUserRoutine,
  deleteUserRoutine,
  listUserRoutines,
  updateUserRoutine,
  type UserRoutine,
  type UserRoutineSchedule,
} from '../../lib/api.ts';
import { ActivityScheduleSheet } from './ActivityScheduleSheet.tsx';
import { joinDays } from './activityDays.ts';
import { useUserRoutinePlay } from './useUserRoutinePlay.tsx';
import '../../styles/settings-editors.css';
import '../../styles/settings-activities.css';

const LOAD_ERROR = "Couldn't load your activities just now — try again shortly.";
const EMPTY = 'Nothing built yet — the ＋ on your plan is where an activity starts.';
const GENERIC_FAIL = "That didn't go through — try again in a moment.";

/** "4 steps · 25 min · run 4 times · on the plan Tue & Fri" — real facts only, each part only as
 *  present as the routine actually is (CLAUDE.md: count what happened, never what broke). Step
 *  count and minutes come from the SAME projection the player uses (`deriveWalkthrough`), so this
 *  line can never disagree with what "Run it now" actually plays. */
function metaLine(routine: UserRoutine): string {
  const w = deriveWalkthrough(routine.session);
  const parts: string[] = [`${w.steps.length} step${w.steps.length === 1 ? '' : 's'}`];
  if (w.total_min > 0) parts.push(`${w.total_min} min`);
  parts.push(routine.runs > 0 ? `run ${routine.runs} time${routine.runs === 1 ? '' : 's'}` : 'never run');
  if (routine.schedule && routine.schedule.days.length > 0) {
    parts.push(`on the plan ${joinDays(routine.schedule.days)}`);
  }
  return parts.join(' · ');
}

export function SettingsYourActivities({
  onBack,
  onEditRoutine,
}: {
  onBack: () => void;
  /** Activity Builder wave 3 seam: opens the steps editor (a parallel parcel) for one routine.
   *  Absent → the "Edit steps" menu item simply doesn't render, never a dead button. */
  onEditRoutine?: (routine: UserRoutine) => void;
}) {
  const [routines, setRoutines] = useState<UserRoutine[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<UserRoutine | null>(null);
  const [scheduling, setScheduling] = useState<UserRoutine | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let alive = true;
    listUserRoutines()
      .then((r) => {
        if (!alive) return;
        if (r) setRoutines(r);
        else setLoadErr(true);
      })
      .catch(() => {
        if (alive) setLoadErr(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const { node: playerNode, play } = useUserRoutinePlay((routineId) => {
    setRoutines(
      (rs) =>
        rs?.map((r) =>
          r.routine_id === routineId ? { ...r, runs: r.runs + 1, last_run: new Date().toISOString() } : r,
        ) ?? rs,
    );
  });

  async function doRename(routine: UserRoutine, name: string) {
    const next = name.trim();
    setRenaming(null);
    if (!next || next === routine.name || !routines) return;
    setBusy(true);
    setMsg('');
    try {
      const updated = await updateUserRoutine(routine.routine_id, { name: next });
      if (updated) setRoutines(routines.map((r) => (r.routine_id === routine.routine_id ? updated : r)));
      else setMsg(GENERIC_FAIL);
    } finally {
      setBusy(false);
    }
  }

  async function doDuplicate(routine: UserRoutine) {
    if (!routines) return;
    setMenuFor(null);
    setBusy(true);
    setMsg('');
    try {
      // " 2" suffixed name, same session, provenance kind preserved — the design's drawn answer.
      // `createUserRoutine` always mints a fresh routine (runs: 0), so there is nothing else here
      // that has to say "start at zero" — that's just what a new routine already is.
      const created = await createUserRoutine({
        name: `${routine.name} 2`,
        ...(routine.area ? { area: routine.area } : {}),
        session: routine.session,
        provenance: routine.provenance,
      });
      if (created) setRoutines([created, ...routines]);
      else setMsg(GENERIC_FAIL);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(routine: UserRoutine) {
    if (!routines) return;
    setBusy(true);
    setMsg('');
    try {
      const ok = await deleteUserRoutine(routine.routine_id);
      if (ok) {
        setRoutines(routines.filter((r) => r.routine_id !== routine.routine_id));
        setDeleting(null);
      } else {
        setMsg(GENERIC_FAIL);
      }
    } finally {
      setBusy(false);
    }
  }

  function scheduleDone(routineId: string, schedule: UserRoutineSchedule | null) {
    setRoutines((rs) => rs?.map((r) => (r.routine_id === routineId ? { ...r, schedule } : r)) ?? rs);
    setScheduling(null);
  }

  if (playerNode) return playerNode;

  return (
    <div className="fh">
      <div className="fh-head">
        <button className="fh-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <b className="fh-title">Your activities</b>
      </div>
      <div className="fh-body">
        <div className="se-kicker">Built by you. The coach can schedule them, never edit them.</div>

        <div className="se-card">
          {loadErr && <div className="se-note">{LOAD_ERROR}</div>}
          {routines === null && !loadErr && <div className="se-empty">Loading…</div>}
          {routines !== null && routines.length === 0 && <div className="se-empty">{EMPTY}</div>}
          {routines !== null &&
            routines.map((r) =>
              renaming === r.routine_id ? (
                <RenameRow key={r.routine_id} routine={r} busy={busy} onSave={(name) => void doRename(r, name)} />
              ) : (
                <ActivityRow
                  key={r.routine_id}
                  routine={r}
                  menuOpen={menuFor === r.routine_id}
                  canEdit={!!onEditRoutine}
                  onToggleMenu={() => setMenuFor(menuFor === r.routine_id ? null : r.routine_id)}
                  onRun={() => {
                    setMenuFor(null);
                    play(r);
                  }}
                  onRename={() => {
                    setMenuFor(null);
                    setRenaming(r.routine_id);
                  }}
                  onEditSteps={() => {
                    setMenuFor(null);
                    onEditRoutine?.(r);
                  }}
                  onDuplicate={() => void doDuplicate(r)}
                  onSchedule={() => {
                    setMenuFor(null);
                    setScheduling(r);
                  }}
                  onDelete={() => {
                    setMenuFor(null);
                    setDeleting(r);
                  }}
                />
              ),
            )}
        </div>

        {msg && <div className="se-note">{msg}</div>}
      </div>

      {deleting && (
        <DeleteConfirm
          routine={deleting}
          busy={busy}
          onKeep={() => setDeleting(null)}
          onDelete={() => void doDelete(deleting)}
        />
      )}
      {scheduling && (
        <ActivityScheduleSheet
          routine={scheduling}
          onClose={() => setScheduling(null)}
          onDone={(schedule) => scheduleDone(scheduling.routine_id, schedule)}
        />
      )}
    </div>
  );
}

function ActivityRow({
  routine,
  menuOpen,
  canEdit,
  onToggleMenu,
  onRun,
  onRename,
  onEditSteps,
  onDuplicate,
  onSchedule,
  onDelete,
}: {
  routine: UserRoutine;
  menuOpen: boolean;
  canEdit: boolean;
  onToggleMenu: () => void;
  onRun: () => void;
  onRename: () => void;
  onEditSteps: () => void;
  onDuplicate: () => void;
  onSchedule: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="se-goal-row">
      <span className="se-goal-t">
        <b>{routine.name}</b>
        <span className="se-goal-meta">{metaLine(routine)}</span>
      </span>
      <span className="se-kebab-wrap">
        <button className="se-kebab-btn" onClick={onToggleMenu} aria-label={`Options for ${routine.name}`}>
          ⋯
        </button>
        {menuOpen && (
          <div className="se-kebab-menu" role="menu">
            <button role="menuitem" onClick={onRun}>
              Run it now
            </button>
            <button role="menuitem" onClick={onRename}>
              Rename
            </button>
            {canEdit && (
              <button role="menuitem" onClick={onEditSteps}>
                Edit steps
              </button>
            )}
            <button role="menuitem" onClick={onDuplicate}>
              Duplicate
            </button>
            <button role="menuitem" onClick={onSchedule}>
              Schedule it…
            </button>
            <button role="menuitem" className="se-danger" onClick={onDelete}>
              Delete…
            </button>
          </div>
        )}
      </span>
    </div>
  );
}

function RenameRow({ routine, busy, onSave }: { routine: UserRoutine; busy: boolean; onSave: (name: string) => void }) {
  const [draft, setDraft] = useState(routine.name);
  return (
    <div className="se-goal-row">
      <span className="se-rename-row">
        <input
          className="wiz-in"
          value={draft}
          autoFocus
          disabled={busy}
          aria-label={`Rename ${routine.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave(draft);
            if (e.key === 'Escape') onSave(routine.name);
          }}
        />
        <button className="se-rename-save" disabled={busy} onClick={() => onSave(draft)}>
          Save
        </button>
        <button className="se-rename-cancel" disabled={busy} onClick={() => onSave(routine.name)}>
          Cancel
        </button>
      </span>
    </div>
  );
}

function DeleteConfirm({
  routine,
  busy,
  onKeep,
  onDelete,
}: {
  routine: UserRoutine;
  busy: boolean;
  onKeep: () => void;
  onDelete: () => void;
}) {
  const n = routine.runs;
  return (
    <div className="se-confirm-scrim" onClick={busy ? undefined : onKeep}>
      <div
        className="se-confirm-card"
        role="dialog"
        aria-label={`Delete ${routine.name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="se-confirm-t">Delete &quot;{routine.name}&quot;?</div>
        <div className="se-confirm-body">
          {`The ${n} session${n === 1 ? '' : 's'} you logged with it stay in your history. `}
          If it&apos;s on the plan, those slots open up.
        </div>
        <div className="se-confirm-actions">
          <button className="se-keep-btn" disabled={busy} onClick={onKeep}>
            Keep it
          </button>
          <button className="se-retire-btn" disabled={busy} onClick={onDelete}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
