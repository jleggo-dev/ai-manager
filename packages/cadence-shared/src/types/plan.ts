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

export interface ActivityTarget {
  metric: string;
  value: number;
  unit?: string;
  progression?: string; // "+0.5km/week"
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
