import type { UnitPrefs } from '@cadence/shared';
import { sql, json } from '../db/sql.ts';
import { mergeConstraints, sameConstraint } from '../services/constraint-merge.ts';
import type {
  Baseline,
  Constraint,
  DietaryProfile,
  MacroTargets,
  PendingProposal,
  PendingPlan,
  PendingWeekReview,
  PointsState,
  SteerBack,
  StreakState,
} from '@cadence/shared';

export interface CadenceUserRow {
  id: string;
  name: string;
  email: string | null;
  baseline: Baseline;
  unit_prefs?: UnitPrefs | null;
  macro_targets: MacroTargets | null;
  timezone: string | null;
  home_location: { lat: number; lon: number; label?: string } | null;
  // Present once migration 0040 is applied. Where you ARE, when that is somewhere other than
  // where you live — read by the Today header's weather + city and by nothing else (A21).
  current_location?: { lat: number; lon: number; label?: string; at?: string } | null;
  steer_back: SteerBack;
  last_assessed_at: string | null;
  pending_proposal: PendingProposal | null;
  pending_plan: PendingPlan | null;
  // Present once migration 0044 is applied. The pointer `open_week_review` writes — which plan
  // week is up for review, never the figures themselves (the app renders those from the user's
  // own data). Older rows (or a pre-migration read) leave it undefined.
  pending_week_review?: PendingWeekReview | null;
  // Present once migration 0015 is applied; older rows (or a pre-migration read) leave it
  // undefined and callers fall back to initialStreakState().
  streak_state?: StreakState | null;
  // Present once migration 0017 is applied (Req 5 dietary safety input).
  dietary_profile?: DietaryProfile | null;
  // Present once migration 0020 is applied (REQ8 rewards); undefined pre-migration → callers fall
  // back to initialPointsState().
  points_state?: PointsState | null;
  // Present once migration 0027 is applied. Which PORTRAIT the user picked — null means they
  // haven't, which every surface renders as the brand mark. Never read by prompts or planning:
  // a face is a picture, not a personality (packages/cadence-shared/src/coach-face.ts).
  coach_face_id?: string | null;
}

export async function getUser(userId: string): Promise<CadenceUserRow | null> {
  const [row] = await sql<CadenceUserRow[]>`select * from cadence.users where id = ${userId}`;
  if (row?.baseline) healConstraintsShape(row.baseline as unknown as Record<string, unknown>, userId);
  return row ?? null;
}

/**
 * Self-healing read for a shape that once bricked a phone. On 2026-08-31 a maintenance script
 * passed pre-stringified JSON where the sql client expects `json()`, and `baseline.constraints`
 * landed as a jsonb STRING whose text was the correct array. Every consumer trusted the shape:
 * the phone crashed AT BOOT mapping it, and the coach turn 500'd building context — one bad write
 * took out both surfaces. The stored row was repaired (scripts/repair-constraints-shape.ts), and
 * this makes the read shrug off a recurrence instead of letting it cascade: a parseable string is
 * quietly unwrapped, anything else non-array becomes an empty list, and either case is logged —
 * never thrown, because "constraints unreadable" must degrade to "none on file", not to no app.
 */
export function healConstraintsShape(baseline: Record<string, unknown>, userId: string): void {
  const c = baseline.constraints;
  if (c === undefined || Array.isArray(c)) return;
  if (typeof c === 'string') {
    try {
      const parsed: unknown = JSON.parse(c);
      if (Array.isArray(parsed)) {
        baseline.constraints = parsed;
        console.warn(`[users] constraints for ${userId} stored as a JSON string — unwrapped on read`);
        return;
      }
    } catch {
      /* falls through to the empty-list floor */
    }
  }
  baseline.constraints = [];
  console.warn(`[users] constraints for ${userId} had a non-array shape — read as none on file`);
}

/**
 * Ensure a cadence.users row exists (the FK anchor for all per-user data). Idempotent. Used by
 * the auth middleware to lazily provision a row on a Supabase user's FIRST authenticated request
 * (no signup trigger needed) and by dev-reset to seed the scratch accounts. `email` is only set on
 * insert — an existing row is left untouched (on conflict do nothing).
 */
export async function ensureUser(userId: string, email: string | null = null): Promise<void> {
  await sql`
    insert into cadence.users (id, email, baseline) values (${userId}, ${email}, ${json({})})
    on conflict (id) do nothing`;
}

/** Set the user's display name (top-level column, not baseline). */
export async function setName(userId: string, name: string): Promise<void> {
  await sql`update cadence.users set name = ${name}, updated_at = now() where id = ${userId}`;
}

/**
 * Merge per-axis display units.
 *
 * Shallow-merged rather than replaced so a Settings control that only knows about one axis cannot
 * blank the other four — the same reason `mergeBaseline` merges. Storage everywhere stays
 * canonical; this only says how numbers are SHOWN.
 */
export async function mergeUnitPrefs(userId: string, patch: Partial<UnitPrefs>): Promise<void> {
  await sql`
    update cadence.users
       set unit_prefs = coalesce(unit_prefs, '{}'::jsonb) || ${json(patch)}, updated_at = now()
     where id = ${userId}`;
}

/** Shallow-merge captured baseline deltas via jsonb `||`. */
export async function mergeBaseline(userId: string, patch: Partial<Baseline>): Promise<void> {
  await sql`
    update cadence.users set baseline = baseline || ${json(patch)}, updated_at = now()
    where id = ${userId}`;
}

/**
 * Merge captured constraints into the stored list — the AMBIENT path, distinct from the wholesale
 * `mergeBaseline` that Settings uses.
 *
 * Read-modify-write inside a transaction with `for update`, because two turns finishing close
 * together would otherwise both read the old list and the second would erase the first's addition
 * — the same class of loss this function exists to fix, just narrower. Writes only the
 * `constraints` key so a concurrent weigh-in or profile edit is untouched.
 */
export async function mergeCapturedConstraints(userId: string, incoming: Constraint[]): Promise<void> {
  if (!incoming.length) return;
  await sql.begin(async (tx) => {
    const rows = await tx<{ baseline: Baseline | null }[]>`
      select baseline from cadence.users where id = ${userId} for update`;
    // Heal-on-read here too: this path maps over the list inside a transaction, and a bad
    // stored shape must degrade, never throw mid-write (see healConstraintsShape).
    if (rows[0]?.baseline) healConstraintsShape(rows[0].baseline as unknown as Record<string, unknown>, userId);
    const existing = (rows[0]?.baseline?.constraints ?? []) as Constraint[];
    const merged = mergeConstraints(existing, incoming);
    await tx`
      update cadence.users
         set baseline = jsonb_set(coalesce(baseline, '{}'::jsonb), '{constraints}', ${json(merged)}),
             updated_at = now()
       where id = ${userId}`;
  });
}

/**
 * Delete a constraint outright. Reserved for "you recorded that wrong — I never had a knee
 * injury": a mis-capture is not history, it is an error, and leaving it on file would keep
 * shaping plans around something that never existed.
 *
 * Recovery is NOT this. "My knee is fine now" keeps the row and marks it quiet — it happened, it
 * may come back, and a coach who forgets it entirely is a coach you have to re-teach.
 */
export async function removeCapturedConstraint(userId: string, label: string): Promise<boolean> {
  let removed = false;
  await sql.begin(async (tx) => {
    const rows = await tx<{ baseline: Baseline | null }[]>`
      select baseline from cadence.users where id = ${userId} for update`;
    // Heal-on-read here too: this path maps over the list inside a transaction, and a bad
    // stored shape must degrade, never throw mid-write (see healConstraintsShape).
    if (rows[0]?.baseline) healConstraintsShape(rows[0].baseline as unknown as Record<string, unknown>, userId);
    const existing = (rows[0]?.baseline?.constraints ?? []) as Constraint[];
    const kept = existing.filter((c) => !sameConstraint(c.label ?? '', label));
    if (kept.length === existing.length) return;
    removed = true;
    await tx`
      update cadence.users
         set baseline = jsonb_set(coalesce(baseline, '{}'::jsonb), '{constraints}', ${json(kept)}),
             updated_at = now()
       where id = ${userId}`;
  });
  return removed;
}

/**
 * Change what a constraint is CALLED, and nothing else.
 *
 * Not a merge, on purpose. `mergeConstraints` keeps the longer telling — right for ambient capture,
 * where a fuller restatement should win — but it makes a correction impossible in the one direction
 * corrections usually run. The Broker wrote "ramp gently because of tendinitis", which reads as an
 * instruction rather than a fact about a body, and every attempt to shorten it was silently
 * discarded by that rule. The owner asked several times and Cadence agreed several times; nothing
 * changed, because nothing could.
 *
 * So a reword goes straight at the label and leaves id, status, kind, plan_around and until exactly
 * where they were: the thing is the same thing, it was just described badly.
 *
 * Matched by `sameConstraint`, and the new label is written verbatim — including a shorter one,
 * which is the whole point.
 */
export async function renameCapturedConstraint(
  userId: string,
  fromLabel: string,
  toLabel: string,
): Promise<{ from: string; to: string } | null> {
  const next = toLabel.trim();
  if (!next) return null;
  let renamed: { from: string; to: string } | null = null;
  await sql.begin(async (tx) => {
    const rows = await tx<{ baseline: Baseline | null }[]>`
      select baseline from cadence.users where id = ${userId} for update`;
    // Heal-on-read here too: this path maps over the list inside a transaction, and a bad
    // stored shape must degrade, never throw mid-write (see healConstraintsShape).
    if (rows[0]?.baseline) healConstraintsShape(rows[0].baseline as unknown as Record<string, unknown>, userId);
    const existing = (rows[0]?.baseline?.constraints ?? []) as Constraint[];
    const at = existing.findIndex((c) => sameConstraint(c.label ?? '', fromLabel));
    if (at === -1) return;
    const prev = existing[at]!;
    if ((prev.label ?? '').trim() === next) {
      renamed = { from: prev.label ?? '', to: next };
      return;
    }
    const updated = existing.map((c, i) => (i === at ? { ...c, label: next } : c));
    await tx`
      update cadence.users
         set baseline = jsonb_set(coalesce(baseline, '{}'::jsonb), '{constraints}', ${json(updated)}),
             updated_at = now()
       where id = ${userId}`;
    renamed = { from: prev.label ?? '', to: next };
  });
  return renamed;
}

export async function setMacroTargets(userId: string, targets: MacroTargets): Promise<void> {
  await sql`
    update cadence.users set macro_targets = ${json(targets)}, updated_at = now()
    where id = ${userId}`;
}

/** Mark the weekly situation_assess gate as run now (§B4) — regardless of whether it fired. */
export async function touchAssessedAt(userId: string): Promise<void> {
  await sql`update cadence.users set last_assessed_at = now() where id = ${userId}`;
}

/** Store (or clear, with null) the coach's pending proposal — the user's accept/dismiss resolves it. */
export async function setPendingProposal(userId: string, proposal: PendingProposal | null): Promise<void> {
  await sql`update cadence.users set pending_proposal = ${proposal ? json(proposal) : null} where id = ${userId}`;
}

/** Store (or clear, with null) a synthesized-but-not-yet-committed plan — the first-lock analog
 *  of setPendingProposal. The user's confirm/dismiss resolves it. */
export async function setPendingPlan(userId: string, plan: PendingPlan | null): Promise<void> {
  await sql`update cadence.users set pending_plan = ${plan ? json(plan) : null} where id = ${userId}`;
}

/** Store (or clear, with null) the pointer `open_week_review` puts up — which plan week is due
 *  for review. The user's open/dismiss on the card resolves it; the review's own figures are
 *  never stored here, only which week to render. */
export async function setPendingWeekReview(userId: string, review: PendingWeekReview | null): Promise<void> {
  await sql`update cadence.users set pending_week_review = ${review ? json(review) : null} where id = ${userId}`;
}

/** Persist the forward-only streak state (Req 4) — written by services/streak.ts after it
 *  finalizes past days. Whole-object replace; the caller owns the merge. */
export async function setStreakState(userId: string, state: StreakState): Promise<void> {
  await sql`update cadence.users set streak_state = ${json(state)} where id = ${userId}`;
}

/** Persist the forward-only points wallet (REQ8) — written by the rewards finalize after it folds
 *  past days / redeems a freeze. Whole-object replace; the caller owns the merge. */
export async function setPointsState(userId: string, state: PointsState): Promise<void> {
  await sql`update cadence.users set points_state = ${json(state)} where id = ${userId}`;
}

/**
 * Set (or clear, with null) the portrait the user picked for the coach. Clearing is a supported
 * choice, not an error state — it returns them to the brand mark rather than to a default face
 * they never chose.
 */
export async function setCoachFaceId(userId: string, faceId: string | null): Promise<void> {
  await sql`update cadence.users set coach_face_id = ${faceId}, updated_at = now() where id = ${userId}`;
}

/** Read dietary profile jsonb (Req 5). Null only if the user row is missing. */
export async function getDietaryProfile(userId: string): Promise<DietaryProfile | null> {
  const [row] = await sql<{ dietary_profile: DietaryProfile }[]>`
    select dietary_profile from cadence.users where id = ${userId}`;
  return row?.dietary_profile ?? null;
}

/** Whole-object replace for Settings confirm-first save (Req 5 WS5). */
export async function setDietaryProfile(userId: string, profile: DietaryProfile): Promise<void> {
  await sql`
    update cadence.users
    set dietary_profile = ${json(profile)}, updated_at = now()
    where id = ${userId}`;
}

export type HomeLocation = { lat: number; lon: number; label?: string };

/**
 * Persist coarse home location + IANA timezone (§B1). Columns exist since migration 0001 —
 * no new migration. Whole-object replace for location; timezone is a plain text column.
 */
export async function setHomeLocation(userId: string, location: HomeLocation, timezone: string | null): Promise<void> {
  await sql`
    update cadence.users
    set home_location = ${json(location)},
        timezone = ${timezone},
        current_location = null,
        updated_at = now()
    where id = ${userId}`;
}

/**
 * Where the user IS, when that is somewhere other than home (A21). Written only after the client's
 * dwell gate is satisfied — five kilometres away and still there twenty minutes later — so this is
 * a settled place, not a train window. `at` is stamped here rather than passed in: the one thing a
 * later reader wants to know about a transient position is how old it is.
 *
 * Deliberately NOT part of setHomeLocation's contract: notification anchoring, planning and the
 * coach all keep reading home_location, and a commute must never move them.
 */
export async function setCurrentLocation(userId: string, location: HomeLocation): Promise<void> {
  await sql`
    update cadence.users
    set current_location = ${json({ ...location, at: new Date().toISOString() })},
        updated_at = now()
    where id = ${userId}`;
}

/** Back home — the header returns to the place it already has a name for. */
export async function clearCurrentLocation(userId: string): Promise<void> {
  await sql`
    update cadence.users
    set current_location = null, updated_at = now()
    where id = ${userId}`;
}

/**
 * Set the IANA timezone ONLY when we don't already have one — the conversational path fills a
 * gap, it never argues with a device-reported or user-chosen zone. Separate from setHomeLocation
 * because someone can tell the coach their timezone without ever naming a city, and until now
 * that sentence went nowhere: `users.timezone` sat null while date-context, the daily check-in
 * and every notification schedule quietly ran on a default.
 */
export async function setTimezoneIfUnset(userId: string, timezone: string): Promise<void> {
  await sql`
    update cadence.users set timezone = ${timezone}, updated_at = now()
    where id = ${userId} and timezone is null`;
}

/** Clear home location (and optionally timezone) — Settings "forget this place". */
export async function clearHomeLocation(userId: string, clearTimezone = false): Promise<void> {
  if (clearTimezone) {
    await sql`
      update cadence.users
      set home_location = null, timezone = null, current_location = null, updated_at = now()
      where id = ${userId}`;
  } else {
    await sql`
      update cadence.users
      set home_location = null, current_location = null, updated_at = now()
      where id = ${userId}`;
  }
}
