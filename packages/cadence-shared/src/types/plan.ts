/* ════════════════════════════════════════════════════════════════
   §5.4 Plan & activities
   ════════════════════════════════════════════════════════════════ */

export interface Plan {
  plan_id: string;
  goal_ids: string[];
  generated_by: 'coach';
  generated_at: string;
  version: number;
  status: 'active' | 'superseded' | 'draft';
  activities: string[]; // activity ids
  /** The coach's reasoning for the WHOLE shape (0031) — the arithmetic, the phases, why the
   *  suggested activities earn their slots. Null on plans committed before it existed. */
  rationale?: string | null;
  /** What the user asked for in their own words, when this version exists BECAUSE they asked
   *  (0034) — "you're being overly protective of my elbow". Null for the first lock and for the
   *  automated weekly re-plan, which nobody steered. */
  steer?: string | null;
  /** How many days this plan's week runs (0049) — 7 unless the user asked the coach to extend it
   *  ("can we plan two weeks ahead?"). `computeWeekState` and the weekly_checkin push both derive
   *  the week's end from it. Optional only for rows read before the migration; the column
   *  defaults to 7. */
  horizon_days?: number;
}

export interface ActivitySchedule {
  recurrence: string; // RRULE, e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  time_of_day?: string;
  /**
   * Minutes of the ACTIVITY ITSELF — the effort the person named, not the whole session
   * (owner ruling 2026-08-17). A 40-minute run is 40 here and gets its warm-up added AROUND it;
   * a 20-minute meditation is 20 minutes of meditating. Warm-up, cool-down and settling in are
   * NOT subtracted from this number and never were meant to be carved out of it.
   *
   * The time to block out in a calendar is derived, not stored: `sessionBudget()` in
   * `session-budget.ts` turns this plus the goal's area into `{ effort_min, prep_min, total_min }`.
   * Once a session has actually been prescribed, the real total is the sum of its blocks
   * (`deriveWalkthrough().total_min`).
   */
  duration_min?: number;
}

/** Deterministic progression rule for an activity under a `plan_mode='deterministic'` goal. The
 *  progression engine (services/progression.ts) uses it to compute each session's numbers from the
 *  eval session + elapsed weeks — no AI call. Absent for coach-mode activities. */
export interface ProgressionScheme {
  quantity: 'load' | 'reps' | 'distance_km' | 'duration_min'; // which number progresses week over week
  kind: 'linear' | 'percent'; // linear: +increment units/week; percent: ×(1 + increment/100) per week
  increment: number; // per week — linear: absolute units (e.g. 5 lb); percent: e.g. 10 = +10%/wk
  deload_every?: number; // every Nth week is a recovery week (e.g. 4 → weeks 4, 8, 12 back off)
  deload_pct?: number; // deload level as a % of the progressed value (default 90)
}

export interface ActivityTarget {
  metric: string;
  value: number;
  unit?: string;
  progression?: string; // "+0.5km/week" — freeform, coach-mode; the deterministic engine uses `scheme`
  scheme?: ProgressionScheme; // set by synthesize_plan for deterministic-mode activities
  hr_cap?: string; // "zone2"
}

export interface Activity {
  activity_id: string;
  /**
   * The COMMITMENT this row is one version of (0036).
   *
   * `activity_id` dies at every Apply — commitActivities supersedes the plan and inserts fresh
   * rows — so it identifies a row, not a thing the user has. `commitment_id` is copied forward
   * instead, which is what makes "my Tuesday easy run" one continuous thing across plan versions:
   * the handle the coach edits by, and the join that keeps six weeks of its history together.
   * Before this, the only thread between versions was the title string.
   */
  commitment_id: string;
  plan_id: string;
  goal_id?: string;
  title: string;
  kind: 'user' | 'system';
  category?: string;
  schedule: ActivitySchedule;
  target?: ActivityTarget;
  completion_source: 'self_report' | 'healthkit' | 'reply' | 'auto';
  why?: string | null; // the coach's rationale (0012; 1-3 sentences since 0031) — walks the ladder in chat + session sheet
  how_to?: string | null; // optional video ref (§6.7)
  disrupted_override?: string | null;
  /** TRUE when the coach proposed this herself (adjacent support), not the user (0031). */
  suggested?: boolean;
}
