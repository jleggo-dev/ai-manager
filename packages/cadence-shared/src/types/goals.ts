/* ════════════════════════════════════════════════════════════════
   §5.2 Goal
   ════════════════════════════════════════════════════════════════ */

import type { GoalArea } from './baseline.ts';

export type GoalType = 'milestone' | 'target' | 'recurring';
export type GoalStatus =
  | 'captured'
  | 'confirmed'
  | 'committed' // was 'locked' — a goal you've committed to a plan (BRAND.md: "Set your rhythm", never a cell door)
  | 'parked'
  | 'completed'
  | 'abandoned';

export interface GoalMeasure {
  metric: string; // "distance" | "protein" | "no_snacking_after" | ...
  target: number | string;
  start?: number | string; // where they are TODAY on this metric (intake: a coach's first question); body weight lives in baseline, never here
  unit?: string;
  direction?: 'increase' | 'decrease';
}

export interface Timeframe {
  start?: string;
  end?: string;
  recurrence?: string | null; // RRULE-ish, e.g. "DAILY"
}

/** A stepping-stone checkpoint on the way to a big goal (e.g. "run a continuous 10k by August"),
 *  proposed by the coach when it pressure-tests realism. Ordered; each ladders toward the goal. */
export interface GoalMilestone {
  id: string;
  label: string;
  target_date?: string; // YYYY-MM-DD
  done?: boolean;
}

export interface Goal {
  goal_id: string;
  title: string;
  /**
   * The few plain facts that decide how hard the work has to be, in the user's own terms —
   * distance, terrain, what the day actually demands, what they've done before, where they're
   * starting from.
   *
   * A title plus an empty measure is not a goal, it is a label. "Complete the Spartan Ultra Beast
   * in Quebec" with `measure: {}` told planning nothing: the 50 km, the mountain, the 30+
   * obstacles, the five-hour finish times, the half marathon last October — every fact that sets
   * the training load lived only in the transcript, which the plan job never sees. So the Broker
   * writes them down here, and they ride along with the goal wherever it goes.
   *
   * Only what was said. Never a summary of what the coach thinks the goal implies.
   */
  brief?: string;
  area: GoalArea;
  type: GoalType;
  measure: GoalMeasure;
  timeframe: Timeframe;
  milestones?: GoalMilestone[]; // stepping-stones toward the goal (coach-proposed, user-editable)
  status: GoalStatus;
  linked_equipment: string[];
  source: 'captured' | 'manual';
  confidence?: number; // Broker extraction confidence
  plan_mode?: 'coach' | 'deterministic'; // how this goal's fitness sessions are programmed (default 'coach'):
  // 'coach' = AI programs each session; 'deterministic' = a progression engine computes them (eval + monthly rebuild stay AI)
}

/** assess_goal — the coach's realism read on ONE goal + proposed stepping-stones (§6.2).
 *  Suggest-only: the app never auto-applies it; the user accepts in Review. */
export interface GoalAssessment {
  verdict: 'on_track' | 'stretch' | 'unrealistic';
  assessment: string; // 1–2 warm, honest sentences in the coach's voice
  suggested_target?: { value: number; unit: string } | null; // if the target should be right-sized
  suggested_end?: string | null; // YYYY-MM-DD, if the deadline should shift
  milestones: Array<{ label: string; target_date?: string }>; // stepping-stones toward the goal
  intake?: string[]; // ≤3 bespoke questions a coach would ask about THIS goal that the data can't answer ("have you raced before?")
}
