import type { Activity, PendingPlanActivity } from '@cadence/shared';
import { expandRecurrence } from './scheduling.ts';
import { clockLabel12 } from './plan-change-detail-labels.ts';

/**
 * The Changes sheet's full-height view: the next seven days as they would be with the proposal
 * applied, grouped by day, the changed sessions marked. Owner ask 2026-11-01: "show the one
 * change — allow the user to see the full week… grouped by day." The point of looking at the
 * week is to see whether the change clashes with anything, so the unchanged sessions are there
 * too (the sheet dims them), and a session that moves shows on BOTH days — gone from the old one,
 * new on the next.
 *
 * Pure: the caller hands it both plans' rows and dates. `index` ties an entry to the change it
 * belongs to (the stored proposal's array position, the same index the toggles use), so the sheet
 * can show a toggled-off change as it is now without asking the server again.
 */

export type WeekEntryKind = 'same' | 'changed' | 'new' | 'was';

export interface WeekEntry {
  title: string;
  /** "6:30 pm", "any time", or null when no time is set. */
  time: string | null;
  minutes?: number;
  /**
   * same — on this day before and after, unchanged. changed — on this day before and after, but
   * different (time, length, contents or name). new — on this day only after. was — on this day
   * only before: it moves away or comes off the plan.
   */
  kind: WeekEntryKind;
  /** The change this entry belongs to; absent on `same`, and on `was` for a dropped commitment. */
  index?: number;
  /** For `changed` whose time moved: the time it had. */
  was_time?: string | null;
}

export interface WeekDay {
  /** YYYY-MM-DD, the person's own calendar day. */
  date: string;
  entries: WeekEntry[];
}

/** One proposal row, the change it belongs to (or none when it changes nothing). */
export interface ProposedRow {
  row: PendingPlanActivity;
  index: number;
  changed: boolean;
}

export interface WeekInputs {
  proposed: ProposedRow[];
  current: Activity[];
  /** First and last day shown, inclusive. */
  from: string;
  to: string;
  /** Recurrence anchors — the active plan's generated_at date, and the date a commit would get. */
  currentAnchor: string;
  proposedAnchor: string;
}

const time = (t?: string | null): string | null => (t?.trim() ? clockLabel12(t) : null);

/** Clock times first, earliest first; "morning"/"any time"/unset after, in title order. */
function sortKey(t?: string | null): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
  return m ? `0${m[1]!.padStart(2, '0')}:${m[2]}` : `1${(t ?? '').trim() || '~'}`;
}

export function buildProposedWeek(w: WeekInputs): WeekDay[] {
  const days = new Map<string, { key: string; entry: WeekEntry }[]>();
  for (const d of expandRecurrence('FREQ=DAILY', w.from, w.to, w.from)) days.set(d, []);
  const put = (date: string, key: string, entry: WeekEntry) => days.get(date)?.push({ key, entry });

  const currentById = new Map(w.current.map((a) => [a.commitment_id, a] as const));
  const kept = new Set<string>();

  for (const { row, index, changed } of w.proposed) {
    const next = new Set(expandRecurrence(row.recurrence, w.from, w.to, w.proposedAnchor));
    const before = row.commitment_id ? currentById.get(row.commitment_id) : undefined;
    if (before) kept.add(before.commitment_id);
    const prev = new Set(
      before ? expandRecurrence(before.schedule.recurrence, w.from, w.to, w.currentAnchor) : [],
    );
    const base = { title: row.title, time: time(row.time_of_day), ...(row.duration_min ? { minutes: row.duration_min } : {}) };

    for (const date of next) {
      const onBoth = prev.has(date);
      if (!changed && onBoth) put(date, sortKey(row.time_of_day), { ...base, kind: 'same' });
      else if (onBoth) {
        const wasTime = time(before!.schedule.time_of_day);
        put(date, sortKey(row.time_of_day), {
          ...base,
          kind: 'changed',
          index,
          ...(wasTime !== base.time ? { was_time: wasTime } : {}),
        });
      } else put(date, sortKey(row.time_of_day), { ...base, kind: 'new', index });
    }
    if (!before) continue;
    for (const date of prev) {
      if (next.has(date)) continue;
      put(date, sortKey(before.schedule.time_of_day), {
        title: before.title,
        time: time(before.schedule.time_of_day),
        ...(before.schedule.duration_min ? { minutes: before.schedule.duration_min } : {}),
        kind: 'was',
        index,
      });
    }
  }

  // Dropped commitments: on their days before, nowhere after, and no toggle to keep them.
  for (const a of w.current) {
    if (kept.has(a.commitment_id)) continue;
    for (const date of expandRecurrence(a.schedule.recurrence, w.from, w.to, w.currentAnchor)) {
      put(date, sortKey(a.schedule.time_of_day), {
        title: a.title,
        time: time(a.schedule.time_of_day),
        ...(a.schedule.duration_min ? { minutes: a.schedule.duration_min } : {}),
        kind: 'was',
      });
    }
  }

  return [...days].map(([date, list]) => ({
    date,
    entries: list
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.entry.title.localeCompare(b.entry.title)))
      .map((x) => x.entry),
  }));
}
