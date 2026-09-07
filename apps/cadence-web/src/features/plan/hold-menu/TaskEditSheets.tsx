import type { PlanViewData } from '../../../lib/api.ts';
import { taskOpener } from '../taskShape.ts';
import { todaysTwin } from './holdMenuModel.ts';
import { PreviewSheet } from './PreviewSheet.tsx';
import { TaskHoldMenu } from './TaskHoldMenu.tsx';
import type { TaskEdits } from './useTaskEdits.ts';

/**
 * Whichever of the trail's two edit sheets is up — the hold menu or the future-task preview —
 * drawn from `useTaskEdits`' state. Its own component so PlanView, already at the size gate,
 * mounts one line rather than two sheets' worth of props.
 *
 * A future MEAL's door opens today's twin (owner, 2026-09-07: "log today's snack?") rather than
 * the move-to-today ask a session gets; with no twin on today, the plain ask takes over.
 */
export function TaskEditSheets({ edits, plan }: { edits: TaskEdits; plan: PlanViewData }) {
  const s = edits.sheet;
  if (!s) return null;
  if (s.kind === 'preview') {
    const twin = taskOpener(s.occ) === 'meal' ? todaysTwin(plan.week, edits.todayIso, s.occ) : null;
    return (
      <PreviewSheet
        occ={s.occ}
        date={s.date}
        todayIso={edits.todayIso}
        week={plan.week}
        onClose={edits.close}
        onDoNow={s.occ.status === 'done' ? undefined : twin ? () => edits.open(twin.occurrence_id) : edits.askDoNow}
      />
    );
  }
  return (
    <TaskHoldMenu
      key={`${s.occ.occurrence_id}:${s.screen}`}
      occ={s.occ}
      date={s.date}
      todayIso={edits.todayIso}
      week={plan.week}
      activities={plan.activities}
      busy={edits.busy}
      error={edits.error}
      initialScreen={s.screen}
      onClose={edits.close}
      onMove={edits.move}
      onDuplicate={edits.duplicate}
      onDelete={edits.remove}
      onDoNow={edits.doNow}
      onOpen={edits.open}
    />
  );
}
