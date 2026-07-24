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
}

export interface ActivitySchedule {
  recurrence: string; // RRULE, e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  time_of_day?: string;
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
  plan_id: string;
  goal_id?: string;
  title: string;
  kind: 'user' | 'system';
  category?: string;
  schedule: ActivitySchedule;
  target?: ActivityTarget;
  completion_source: 'self_report' | 'healthkit' | 'reply' | 'auto';
  why?: string | null; // the coach's one-line rationale, persisted at commit (0012) — walks the ladder in chat + session sheet
  how_to?: string | null; // optional video ref (§6.7)
  disrupted_override?: string | null;
}
