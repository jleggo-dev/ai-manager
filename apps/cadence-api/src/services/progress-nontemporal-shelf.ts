/**
 * `shelf` — bests & firsts, a collection of moments with no axis (docs/cadence/PROGRESS-ENGINE.md
 * W1-5). Binds to `goal_events` (kind completion/note) in a window; most recent first, capped so
 * the shelf reads as a handful of highlights rather than a second history feed.
 */
import type { GoalEvent, ShelfPayload, WidgetOmission } from '@cadence/shared';
import { listGoalEventsInRange } from '../repos/goal-events.ts';
import { omit } from './window-range.ts';

const SHELF_CAP = 8;

/** Pure: fold already-fetched goal events into the shelf shape. */
export function resolveShelf(events: GoalEvent[]): ShelfPayload | WidgetOmission {
  if (events.length === 0) return omit('shelf', 'shelf', 'no goal events in this window');
  const sorted = [...events].sort((a, b) => (a.at < b.at ? 1 : -1));
  return { events: sorted.slice(0, SHELF_CAP).map((e) => ({ label: e.label, at: e.at })) };
}

/** Fetch + resolve for one user's window. */
export async function getShelf(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<ShelfPayload | WidgetOmission> {
  const events = await listGoalEventsInRange(userId, fromDate, toDate);
  return resolveShelf(events);
}
