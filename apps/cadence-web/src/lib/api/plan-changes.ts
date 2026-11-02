import { BASE, headers } from './http.ts';

/* ── The coach's pending plan change (ChangeCard, the Changes sheet) ─────────────────────────
   Split out of plan.ts (at its size gate) when the sheet gained the week view. */

export interface PendingChange {
  changes: string[];
  activities: number;
  created_at: string;
}

/**
 * The change the coach has proposed but nobody has applied yet.
 *
 * Read from the server on purpose: the ChangeCard shows what `propose_plan_change` actually
 * computed, not what the turn announcing it claimed, so the thing the user agrees to is the thing
 * that commits.
 */
export async function getPendingChange(): Promise<PendingChange | null> {
  const res = await fetch(`${BASE}/plan/pending-change`, { headers: headers() });
  if (!res.ok) return null;
  const body = (await res.json()) as { change: PendingChange | null };
  return body.change;
}

/** "Not now" — drop the proposal. The plan is untouched and she can offer again. */
export async function dismissPendingChange(): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/pending-change/dismiss`, { method: 'POST', headers: headers() });
  return res.ok;
}

/* ── Changes sheet (the swap-card toggle surface, check-in rebuild, step 7 client half) ────── */
export interface PendingChangeDetailItem {
  index: number;
  title: string;
  /** The coach's one-line why, when propose_plan_change was given one. Absent for an ordinary
   *  edit that carried no reason. */
  change_reason?: string;
  enabled: boolean;
  /** The active plan's current schedule for this commitment, summarized ("Thu · 6:30 pm"). Null
   *  for a pure add — there is no "now" for a commitment that doesn't exist yet. */
  now: string | null;
  next: string;
  /** What the session will contain from now on, when the change is to its contents — a swap
   *  keeps its days and time, so NOW and NEXT alone read the same. */
  how_to?: string;
}
/** One session on one day of the proposed week (plan-change-week.ts on the API). */
export interface WeekEntry {
  title: string;
  /** "6:30 pm", "any time", or null when no time is set. */
  time: string | null;
  minutes?: number;
  /** same — unchanged; changed — still this day, but different; new — this day only after the
   *  change; was — this day only before (it moves away or comes off the plan). */
  kind: 'same' | 'changed' | 'new' | 'was';
  /** The change it belongs to — the item's `index`, so a toggled-off change can be shown as it is now. */
  index?: number;
  /** A `changed` session whose time moved: the time it had. */
  was_time?: string | null;
}
export interface WeekDay {
  /** YYYY-MM-DD; the first day is the person's today. */
  date: string;
  entries: WeekEntry[];
}
export interface PendingChangeDetail {
  /** The active plan's version, so the sheet can label the row "WEEK {version + 1}". Null when
   *  there is nothing pending. */
  plan_version: number | null;
  /** Only the commitments the change actually alters — never the rest of the plan. */
  items: PendingChangeDetailItem[];
  /** Titles of commitments the change drops. Shown, not toggleable. */
  removed: string[];
  /** The next seven days with the change applied, grouped by day. */
  week: WeekDay[];
}

/**
 * The full per-item view the Changes sheet renders — every proposed swap's title, reason (if the
 * coach gave one), current enabled/disabled toggle state, and NOW → NEXT WEEK schedule. Same
 * fallback shape as getPendingChange: nothing pending (or a read that fails) is an empty list,
 * never a thrown error — the sheet has one honest "nothing to show" message for all of them.
 */
export async function getPendingChangeDetail(): Promise<PendingChangeDetail> {
  const res = await fetch(`${BASE}/plan/pending-change/detail`, { headers: headers() }).catch(() => null);
  if (!res?.ok) return { plan_version: null, items: [], removed: [], week: [] };
  return res.json();
}

/**
 * Persist the sheet's toggle flips before applying. `index` addresses the STORED array position —
 * stable, because propose_plan_change never reorders it — so these survive to the commit funnel
 * (resolveToggledActivities in plan-partial-apply.ts) even though the tap that applies happens in
 * a separate call (applyPendingChange).
 */
export async function setPendingChangeToggles(toggles: { index: number; enabled: boolean }[]): Promise<boolean> {
  const res = await fetch(`${BASE}/plan/pending-change/toggles`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ toggles }),
  }).catch(() => null);
  return !!res?.ok;
}

/**
 * Apply the change the coach put up — the change card's Apply and the Changes sheet's button. The
 * server commits it inside the request: `ok` means it landed, and a refusal carries the server's
 * own words (`message`; null when there were none, or the request never got an answer).
 *
 * These buttons used to call lockPlan, which became a background run answering 202 — and since
 * they read anything but 200 as failure, every change that landed said "That didn't take".
 */
export async function applyPendingChange(): Promise<{ ok: true } | { ok: false; message: string | null }> {
  const res = await fetch(`${BASE}/plan/pending-change/apply`, { method: 'POST', headers: headers() }).catch(
    () => null,
  );
  if (res?.ok) return { ok: true };
  const body = res ? ((await res.json().catch(() => null)) as { violations?: string[] } | null) : null;
  return { ok: false, message: body?.violations?.length ? body.violations.join(' ') : null };
}
