import type { PlanViewData } from '../../../lib/api.ts';
import { PreviewSheet } from './PreviewSheet.tsx';
import { TaskHoldMenu } from './TaskHoldMenu.tsx';
import type { TaskEdits } from './useTaskEdits.ts';

/**
 * Whichever of the trail's two edit sheets is up — the hold menu or the future-task preview —
 * drawn from `useTaskEdits`' state. Its own component so PlanView, already at the size gate,
 * mounts one line rather than two sheets' worth of props.
 */
export function TaskEditSheets({ edits, plan }: { edits: TaskEdits; plan: PlanViewData }) {
  const s = edits.sheet;
  if (!s) return null;
  if (s.kind === 'preview') {
    return (
      <PreviewSheet
        occ={s.occ}
        date={s.date}
        todayIso={edits.todayIso}
        week={plan.week}
        onClose={edits.close}
        onDoNow={s.occ.status === 'done' ? undefined : edits.askDoNow}
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
