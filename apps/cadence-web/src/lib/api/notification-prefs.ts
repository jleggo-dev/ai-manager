import type { IosWeekday, NudgeKind, NudgeTier, NudgeWaypoint, SchedulableActivity } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/**
 * The volume dial, as the server resolves it.
 *
 * `includes` / `excludes` / `maxPerDay` are computed server-side even though the client could
 * derive them from the same shared catalog. That is on purpose: the "MODERATE MEANS" card is a
 * promise about what will and will not arrive, and the only way it cannot drift from the gate that
 * actually withholds a notification is for both to read the same answer from the same place.
 */
export interface NotificationPrefs {
  enabled: boolean;
  tier: NudgeTier;
  /** Local wall-clock minutes from midnight. The window may wrap midnight. */
  quietStartMin: number;
  quietEndMin: number;
  includes: NudgeKind[];
  excludes: NudgeKind[];
  maxPerDay: number;
}

export type NotificationPrefsPatch = Partial<
  Pick<NotificationPrefs, 'enabled' | 'tier' | 'quietStartMin' | 'quietEndMin'>
>;

export async function getNotificationPrefs(): Promise<NotificationPrefs | null> {
  const res = await fetch(`${BASE}/me/notification-prefs`, { headers: headers() });
  if (!res.ok) return null;
  return (await res.json()) as NotificationPrefs;
}

/**
 * Save a patch and return what the server actually stored.
 *
 * Returns null on failure rather than throwing, and the caller then leaves the dial where the
 * server last confirmed it. A control that moves optimistically and silently fails is the worst
 * outcome here: the user believes they turned Cadence down, and Cadence keeps talking.
 */
export async function saveNotificationPrefs(patch: NotificationPrefsPatch): Promise<NotificationPrefs | null> {
  const res = await fetch(`${BASE}/me/notification-prefs`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  return (await res.json()) as NotificationPrefs;
}

/**
 * The inputs the DEVICE needs to schedule the four local nudges, resolved server-side.
 *
 * Resolved there because the suppression rules are the important part and they need data the plan
 * view does not carry — the streak state (was yesterday already covered by a freeze?), the episode
 * table (is this a detour, so waypoints are silence?) and the goal set. The device still owns the
 * scheduling itself: quiet-hours clamping, tier gating and the iOS ceiling all need its own clock.
 */
export interface LocalNudgePlan {
  today: string;
  todayWeekday: IosWeekday;
  nowMinutes: number;
  activities: SchedulableActivity[];
  flexibleToday: SchedulableActivity | null;
  yesterday: { done: number; planned: number } | null;
  waypoints: NudgeWaypoint[];
}

/** Null on any failure — the caller then cancels rather than scheduling a guess. */
export async function getLocalNudgePlan(): Promise<LocalNudgePlan | null> {
  const res = await fetch(`${BASE}/me/local-nudges`, { headers: headers() });
  if (!res.ok) return null;
  return (await res.json()) as LocalNudgePlan;
}
