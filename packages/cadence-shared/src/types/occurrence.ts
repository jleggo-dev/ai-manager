/* ════════════════════════════════════════════════════════════════
   §5.5 Occurrence / completion log  (+ §B1 weather)
   ════════════════════════════════════════════════════════════════ */

// `paused` = a base occurrence shelved for the duration of a disrupted episode (Req 4): the base
// plan is preserved, not deleted, and a paused day is never a slip. System-set only — the client
// status endpoint never accepts it (see occurrenceStatusBodySchema).
export type OccurrenceStatus = 'pending' | 'done' | 'skipped' | 'missed' | 'paused';

export interface Provenance {
  source: 'self_report' | 'apple_health' | 'reply' | 'auto';
  auto: boolean;
  recorded_at: string;
}

export interface OccurrenceWeather {
  temp_c: number;
  conditions: string;
  wind_kph: number;
  source: 'weather_api';
  logged_at: string;
}

/* ── The Prescribe → Log → Adapt module shape (fitness first, but DELIBERATELY generic:
      items, not exercises — a practice-area session ("say these prayers", "morning pages")
      flows through the same types/pipe with no new code) ─────────────────────────────── */

/**
 * How the walkthrough should PLAY a step (REQ8) — the coach's EXPLICIT choice, because only the
 * coach has judgment the quantities can't carry: a 1-min plank is a `timer`, a 1-min "find a
 * comfortable seat" is a `read`. Optional + additive — an untagged item falls back to inference
 * from its quantities (deriveWalkthrough/inferTool). This is the per-item subset the coach picks;
 * the full renderable catalog (incl. insight tools placed by the app) lives in walkthrough.ts.
 */
export type SessionItemTool = 'read' | 'timer' | 'reps' | 'checkoff' | 'photo' | 'journal';

/** One prescribed item in a session — an exercise, a run segment, a practice step. Only the
 *  quantity fields that apply are set; the UI renders whichever are present ("3×8 @ 55 lb"). */
export interface SessionItem {
  name: string;
  sets?: number;
  reps?: number;
  load?: string; // user-facing, unit included: "55 lb", "bodyweight", "zone 2"
  duration_min?: number;
  distance_km?: number;
  detail?: string; // one short cue/instruction
  video_query?: string | null; // YouTube SEARCH phrase only — never a URL (client builds the link)
  tool?: SessionItemTool; // coach's explicit render/play choice; falls back to inference when unset
}

export interface SessionBlock {
  label: string; // "Warm-up", "Main", "Finisher", "Practice"
  items: SessionItem[];
}

/** The coach's generated prescription for ONE occurrence. A regenerable cache (see migration
 *  0010): replan wipes future pending occurrences and this regenerates on next open. */
export interface OccurrenceSession {
  blocks: SessionBlock[];
  note: string; // coach's one-liner: progression rationale or first-session framing
  generated_at: string;
  version: number;
}

/** One reported item in the user's post-session log (parsed from their own words). */
export interface OccurrenceLogItem {
  name: string;
  done?: boolean;
  sets?: number;
  reps?: number;
  load?: string;
  duration_min?: number;
  distance_km?: number;
  felt?: 'easy' | 'right' | 'hard';
}

/** The user's structured report for ONE occurrence — durable history (feeds adaptation). */
export interface OccurrenceLog {
  items: OccurrenceLogItem[];
  summary: string; // one legible sentence for UI + coach context
  raw_text: string; // the user's exact words, never lost
  logged_at: string;
}

export interface Occurrence {
  occurrence_id: string;
  activity_id: string;
  date: string;
  status: OccurrenceStatus;
  value?: Record<string, number>; // numeric rollups, e.g. { distance_km: 5.2, avg_hr: 138 }
  provenance?: Provenance;
  weather?: OccurrenceWeather; // outdoor activities only
  session?: OccurrenceSession | null; // prescription (cached; may be unset until first open)
  log?: OccurrenceLog | null; // the user's report
  episode_id?: string | null; // set on the TEMP "do what you can" occurrences a disrupted episode adds (Req 4)
}
