import type { ClockUnit } from '@cadence/shared';
import { rowMeta, type WeekRowLike } from './weekGroups.ts';

/**
 * What a proposed week CHANGES about the committed one — the part the person is actually being
 * asked to agree to.
 *
 * The Adjust sheet drew the whole proposed week and asked "make this my week?", so a one-line
 * tweak read as a seven-day decision: "it feels like I have to see the whole plan to accept it"
 * (owner, 2026-09-01). This is the arithmetic behind showing the difference first — added,
 * dropped, and changed rows — with the whole week one tap away.
 *
 * PURE: two lists in, four lists out, no clock, no fetch. Rows pair up by `commitment_id` when
 * both sides carry one (the lineage a proposal keeps so "my Tuesday run" stays one thing across
 * versions), and by title otherwise — a proposal drawn without lineage would otherwise read as
 * "everything dropped, everything new", which is noise, not a diff.
 */

export type ChangeKind = 'renamed' | 'moved' | 'retimed' | 'resized';

export interface ChangedRow<T extends WeekRowLike = WeekRowLike> {
  before: WeekRowLike;
  after: T;
  what: ChangeKind[];
}

export interface WeekDiff<T extends WeekRowLike = WeekRowLike> {
  added: T[];
  removed: WeekRowLike[];
  changed: ChangedRow<T>[];
  unchanged: T[];
  /** True when there IS a committed week to compare against. A first plan has none. */
  comparable: boolean;
}

const norm = (s: string | undefined | null): string => (s ?? '').trim().toLowerCase();

function whatChanged(before: WeekRowLike, after: WeekRowLike): ChangeKind[] {
  const what: ChangeKind[] = [];
  if (norm(before.title) !== norm(after.title)) what.push('renamed');
  if (norm(before.recurrence) !== norm(after.recurrence)) what.push('moved');
  if (norm(before.time_of_day) !== norm(after.time_of_day)) what.push('retimed');
  if ((before.duration_min ?? null) !== (after.duration_min ?? null)) what.push('resized');
  return what;
}

export function diffWeek<T extends WeekRowLike>(committed: WeekRowLike[], proposed: T[]): WeekDiff<T> {
  const diff: WeekDiff<T> = { added: [], removed: [], changed: [], unchanged: [], comparable: committed.length > 0 };
  if (!diff.comparable) {
    diff.added = [...proposed];
    return diff;
  }

  const unmatched = new Set(committed);
  const byCommitment = new Map<string, WeekRowLike>();
  for (const c of committed) if (c.commitment_id) byCommitment.set(c.commitment_id, c);

  /** The committed row this proposed row is a version of: lineage first, then an exact title. */
  const pair = (p: T): WeekRowLike | undefined => {
    const byLineage = p.commitment_id ? byCommitment.get(p.commitment_id) : undefined;
    if (byLineage && unmatched.has(byLineage)) return byLineage;
    for (const c of unmatched) if (norm(c.title) === norm(p.title)) return c;
    return undefined;
  };

  for (const p of proposed) {
    const before = pair(p);
    if (!before) {
      diff.added.push(p);
      continue;
    }
    unmatched.delete(before);
    const what = whatChanged(before, p);
    if (what.length === 0) diff.unchanged.push(p);
    else diff.changed.push({ before, after: p, what });
  }
  diff.removed = [...unmatched];
  return diff;
}

/** How many rows the person is being asked about. Zero means the proposal is the same week. */
export function diffSize(diff: WeekDiff): number {
  return diff.added.length + diff.removed.length + diff.changed.length;
}

/**
 * Whether the changes-first view is the right opening view. It is when there is a committed week
 * to compare against and the proposal keeps at least one row of it — a proposal that keeps
 * nothing is a rebuild, and a rebuild IS the whole week, so drawing "everything dropped,
 * everything new" would only be the same list twice.
 */
export function changesFirst(diff: WeekDiff): boolean {
  return diff.comparable && diff.unchanged.length > 0 && diffSize(diff) > 0;
}

/** "Was: “Weighted hill intervals” · Tuesdays · 06:00 · 40 min" — only the parts that moved. */
export function wasLine(c: ChangedRow, clock: ClockUnit): string {
  const bits: string[] = [];
  if (c.what.includes('renamed')) bits.push(`“${c.before.title}”`);
  const meta = rowMeta(c.before, 'floating', clock);
  if (meta && c.what.some((w) => w !== 'renamed')) bits.push(meta);
  return `Was: ${bits.join(' · ')}`;
}
