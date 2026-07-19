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
  area: GoalArea;
  type: GoalType;
  measure: GoalMeasure;
  timeframe: Timeframe;
  milestones?: GoalMilestone[]; // stepping-stones toward the goal (coach-proposed, user-editable)
  status: GoalStatus;
  linked_equipment: string[];
  source: 'captured' | 'manual';
  confidence?: number; // Scribe extraction confidence
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
