/* ════════════════════════════════════════════════════════════════
   §C4 Broker job contracts — flat top-level JSON. Assert app-side.
   ════════════════════════════════════════════════════════════════ */

import type { Baseline } from './baseline.ts';
import type { Goal } from './goals.ts';
import type { Equipment } from './equipment.ts';
import type { ActivityTarget } from './plan.ts';
import type { OccurrenceLogItem } from './occurrence.ts';

/** capture_extract — conversation window → captured deltas. */
export interface CaptureExtractResult {
  goals: Partial<Goal>[];
  equipment: Partial<Equipment>[];
  baseline_updates: Partial<Baseline>;
  confidence: 'high' | 'medium' | 'low';
}

/** plan_vet — proposed plan JSON → validity verdict. */
export interface PlanVetResult {
  valid: boolean;
  violations: string[];
  verified: boolean; // false if the verifier itself bailed (output-verification.md)
}

/** parse_session_log — the user's own words + the prescribed session → structured log. */
export interface ParsedSessionLog {
  items: OccurrenceLogItem[];
  summary: string;
  metrics: Record<string, number>; // unit-suffixed rollups, e.g. { distance_km: 5.2 }
}

/** situation_assess — state snapshot → recommended action (§B3/§B4). */
export interface SituationAssessResult {
  recommend_replan: boolean;
  enter_disrupted: boolean;
  open_checkin: boolean;
  reason: string;
  suggested_levers?: string[];
}

/** What accepting a proposal DOES (Req 4). Absent ⇒ 'replan' (the original, back-compatible
 *  behavior). 'enter_disrupted' starts a detour; 'rebaseline' is the week-gap coach reset (Phase E). */
export type ProposalAction = 'replan' | 'enter_disrupted' | 'rebaseline';

/** A situation_assess recommendation awaiting the user's accept/dismiss — never auto-applied
 *  (suggest-never-auto-apply, BRAND.md's autonomy stance). Stored per-user until resolved. */
export interface PendingProposal {
  reason: string;
  suggested_levers: string[];
  created_at: string;
  action?: ProposalAction; // undefined = 'replan'
  episode_type?: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom'; // for action 'enter_disrupted'
}

/** One activity in a synthesized-but-not-yet-committed plan. Carries both the raw fields
 *  needed to actually commit it (recurrence, target, ...) and `cadence`, the humanized string
 *  for display — computed once at preview time so nothing needs re-deriving either side. */
export interface PendingPlanActivity {
  /**
   * Which existing commitment this is a new version OF (0036). Absent means genuinely new — the
   * column defaults to a fresh lineage. Carried through preview and commit so tapping Apply
   * changes a commitment rather than replacing it with a look-alike that has no past.
   */
  commitment_id?: string;
  title: string;
  kind: 'user' | 'system';
  category?: string;
  cadence: string; // humanized, e.g. "Every other day" — display only
  recurrence: string; // raw RRULE — what actually gets committed
  time_of_day?: string;
  /** Minutes of the effort itself, not the whole session — see `ActivitySchedule.duration_min`.
   *  The card renders it beside the time to set aside, which `sessionBudget()` derives. */
  duration_min?: number;
  target?: ActivityTarget;
  completion_source: 'self_report' | 'healthkit' | 'reply' | 'auto';
  goal_id?: string; // the objective this commitment serves (null for foundational/system items)
  goal_title?: string; // display only — the objective's title, for grouping the preview by goal
  why?: string; // display only — the coach's rationale for THIS commitment, 1-3 sentences (the coached ladder, explained)
  /**
   * What this commitment should actually CONTAIN, when the user has said. Not display copy — it
   * is fed to prescribe-session, so "dead hangs, not farmers carries" changes the session she
   * writes from here on. Carried through preview and commit so an edit or a re-plan cannot
   * silently drop an instruction the person gave (activities.how_to, read by session-generate).
   */
  how_to?: string;
  suggested?: boolean; // TRUE when the coach proposed this herself (adjacent support), not the user
}

/** The FIRST-lock analog of PendingProposal: synthesize_plan + plan_vet already ran, the result
 *  is vetted and ready — but nothing is committed until the user confirms. `goal_ids` pins which
 *  goals this was built for, so confirm commits exactly what was previewed. */
export interface PendingPlan {
  activities: PendingPlanActivity[];
  note: string;
  /** The coach's whole-shape reasoning (0031) — persisted at commit so the card can render it. */
  rationale?: string;
  /** What the USER asked for in their own words, if they asked for anything (0034). Rides the
   *  pending plan so the commit can persist it onto the version this ask produced. */
  steer?: string;
  goal_ids: string[];
  created_at: string;
}

/** context_select — current turn → which retrieval FUNCTIONS to call just-in-time (§4.3).
 *  Same calls-shape as pack_select, but scoped to the turn; [] when the standing pack covers it. */
export interface ContextSelectResult {
  calls: Array<{ fn: string; params?: Record<string, unknown> }>;
  reason?: string;
}

/**
 * capture_detour — conversation window → a CONFIRMED detour agreement, or null.
 *
 * The conversational door into disrupted mode (REQ4 entry path #2): the coach runs the exchange
 * in chat — what kind of disruption, how long, what they'll have with them — and the user's plain
 * yes IS the trigger. This job never proposes and never guesses: `detour` is null unless the coach
 * offered to set it up AND the user clearly agreed in the window. The talker is never the
 * form-filler (REQ10 §11) — the coach converses, this contract is how the Broker acts on it.
 */
export interface CaptureDetourResult {
  /** While an episode is ACTIVE the job flips modes: `detour` stays null (one detour at a time)
   *  and this carries the arrived equipment answer — "ok, the gym has dumbbells and a rower" —
   *  their words, only when newly stated in the window. Null in enter mode and in silence. */
  equipment_update?: Array<{ name: string }> | null;
  detour: {
    type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
    /** Arrival date (YYYY-MM-DD) when the trip starts LATER — "I'm travelling Thursday" said on
     *  Monday. Null/absent means it has already begun. A scheduled detour pauses nothing until
     *  this date; the app checks in on arrival for the equipment answer (owner, 2026-08-04). */
    start?: string;
    /** Window length in days when no explicit end date was stated. */
    days?: number;
    /** Explicit end date (YYYY-MM-DD) when the user gave real dates. */
    end?: string;
    /** What they said they'll have with them — names only, in their words. */
    available_equipment: Array<{ name: string }>;
    /** True ONLY on explicit user assent to the coach's offer ("yes, set it up"). */
    confirmed: boolean;
  } | null;
}
