import { useState } from 'react';
import type { PlanOccurrence, PlanViewData } from '../../../lib/api.ts';
// The concrete module, not the `lib/api` barrel: PlanView's tests mock the barrel with a fixed
// export list, and a hook reaching through it for three new functions would fail at the seam.
import {
  deleteOccurrence,
  duplicateOccurrence,
  moveOccurrence,
  type OccurrenceEditOutcome,
} from '../../../lib/api/occurrence-edit.ts';
import { setOccurrence } from '../../../lib/api/plan.ts';
import { localTodayIso } from '../../../lib/query/keys.ts';
import { dayRelation } from './holdMenuModel.ts';
import type { HoldScreen } from './TaskHoldMenu.tsx';

export type EditSheet =
  | { kind: 'menu'; occ: PlanOccurrence; date: string; screen: HoldScreen }
  | { kind: 'preview'; occ: PlanOccurrence; date: string };

/** Plain, and never silent (PLAN-CHANGES.md Phase 0) — every failed edit says so in the sheet. */
export function editFailureLine(
  r: Exclude<OccurrenceEditOutcome, { ok: true }> | { reason: 'gone' | 'failed' },
  title: string,
) {
  switch (r.reason) {
    case 'already_there':
      return `That day already has ${title}.`;
    case 'out_of_range':
      return "That day isn't in this week any more — take a fresh look at your week.";
    case 'gone':
      return 'This one moved with your new plan — take a fresh look at your week.';
    default:
      return "That didn't take — try again in a moment.";
  }
}

/**
 * The trail's two gestures, routed (owner, 2026-09-07): a TAP opens today's and the past's tasks
 * as ever and previews a future one; a HOLD opens the menu. The edits themselves — move, copy,
 * delete, "do it now" — run here, with one busy flag and one failure line, and every landed edit
 * refetches the week so the trail catches up. Nothing is applied optimistically: a moved disc
 * appears where it landed, after it landed.
 */
export function useTaskEdits({
  plan,
  refresh,
  openTask,
}: {
  plan: PlanViewData | undefined;
  refresh: () => void;
  /** The task's own sheet — StartSheet, CaptureSheet, CookSheet — by the same router a tap uses. */
  openTask: (occ: PlanOccurrence) => void;
}) {
  const [sheet, setSheet] = useState<EditSheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const todayIso = plan?.week.find((d) => d.isToday)?.date ?? localTodayIso();

  function close() {
    setSheet(null);
    setError(null);
  }

  const tap = (occ: PlanOccurrence, date: string) =>
    dayRelation(date, todayIso) === 'future' ? setSheet({ kind: 'preview', occ, date }) : openTask(occ);
  const hold = (occ: PlanOccurrence, date: string) => setSheet({ kind: 'menu', occ, date, screen: 'menu' });
  /** The preview's one door: straight to the hold menu's "move it to today" ask. */
  const askDoNow = () => {
    if (sheet) setSheet({ kind: 'menu', occ: sheet.occ, date: sheet.date, screen: 'do-now' });
  };

  /** A row by id, from the week on screen — else the held row wearing the id (and the status the
   *  server named, when it did), which is enough for the sheets (they fetch by id) and right for
   *  the title. */
  function rowById(id: string, fallback: PlanOccurrence, status?: PlanOccurrence['status']): PlanOccurrence {
    for (const d of plan?.week ?? []) {
      const hit = d.occurrences.find((o) => o.occurrence_id === id);
      if (hit) return hit;
    }
    return { ...fallback, occurrence_id: id, ...(status ? { status } : {}) };
  }

  /**
   * Open a row to DO it. A skipped or missed row is still doable (owner, 2026-09-07: skipped is
   * not finished) — but the start sheet only starts a PENDING row and says "already marked
   * skipped" to anything else, so "do it now" sets it back to pending first. Best-effort: if the
   * reset does not land, the sheet still opens and says what it sees.
   */
  async function openDoable(occ: PlanOccurrence) {
    if (occ.status !== 'skipped' && occ.status !== 'missed') return openTask(occ);
    await setOccurrence(occ.occurrence_id, 'pending').catch(() => undefined);
    refresh();
    openTask({ ...occ, status: 'pending' });
  }

  async function run<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    setBusy(true);
    setError(null);
    const r = await work().catch(() => fallback);
    setBusy(false);
    return r;
  }

  const FAILED = { ok: false, reason: 'failed' } as const;

  async function move(date: string) {
    if (!sheet) return;
    const r = await run(() => moveOccurrence(sheet.occ.occurrence_id, date), FAILED);
    if (!r.ok) return setError(editFailureLine(r, sheet.occ.title));
    close();
    refresh();
  }

  async function duplicate(date: string) {
    if (!sheet) return;
    const r = await run(() => duplicateOccurrence(sheet.occ.occurrence_id, date), FAILED);
    if (!r.ok) return setError(editFailureLine(r, sheet.occ.title));
    close();
    refresh();
  }

  async function remove() {
    if (!sheet) return;
    const r = await run(() => deleteOccurrence(sheet.occ.occurrence_id), FAILED);
    if (!r.ok) return setError(editFailureLine({ reason: r.reason ?? 'failed' }, sheet.occ.title));
    close();
    refresh();
  }

  /** Move onto today, then open — the id survives the move, so the same sheet opens on the same
   *  row. A day that already holds it (a race with the week on screen) opens that row instead. */
  async function doNow() {
    if (!sheet) return;
    const occ = sheet.occ;
    const r = await run(() => moveOccurrence(occ.occurrence_id, todayIso), FAILED);
    if (r.ok) {
      close();
      refresh();
      return openDoable(occ);
    }
    if (r.reason === 'already_there') {
      close();
      return openDoable(rowById(r.existing_occurrence_id, occ, r.existing_status as PlanOccurrence['status']));
    }
    setError(editFailureLine(r, occ.title));
  }

  /** "Do it now" on today's own row, or on the twin already sitting on today. */
  function open(id: string) {
    if (!sheet) return;
    const occ = rowById(id, sheet.occ);
    close();
    void openDoable(occ);
  }

  return { sheet, busy, error, todayIso, tap, hold, askDoNow, close, move, duplicate, remove, doNow, open };
}

export type TaskEdits = ReturnType<typeof useTaskEdits>;
