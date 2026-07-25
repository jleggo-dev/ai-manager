/* ════════════════════════════════════════════════════════════════
   §C4 Scribe job contracts — flat top-level JSON. Assert app-side.
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
  title: string;
  kind: 'user' | 'system';
  category?: string;
  cadence: string; // humanized, e.g. "Every other day" — display only
  recurrence: string; // raw RRULE — what actually gets committed
  time_of_day?: string;
  duration_min?: number;
  target?: ActivityTarget;
  completion_source: 'self_report' | 'healthkit' | 'reply' | 'auto';
  goal_id?: string; // the objective this commitment serves (null for foundational/system items)
  goal_title?: string; // display only — the objective's title, for grouping the preview by goal
  why?: string; // display only — the coach's one-line rationale for THIS commitment (the coached ladder, explained)
}

/** The FIRST-lock analog of PendingProposal: synthesize_plan + plan_vet already ran, the result
 *  is vetted and ready — but nothing is committed until the user confirms. `goal_ids` pins which
 *  goals this was built for, so confirm commits exactly what was previewed. */
export interface PendingPlan {
  activities: PendingPlanActivity[];
  note: string;
  goal_ids: string[];
  created_at: string;
}

/** context_select — current turn → which retrieval FUNCTIONS to call just-in-time (§4.3).
 *  Same calls-shape as pack_select, but scoped to the turn; [] when the standing pack covers it. */
export interface ContextSelectResult {
  calls: Array<{ fn: string; params?: Record<string, unknown> }>;
  reason?: string;
}
