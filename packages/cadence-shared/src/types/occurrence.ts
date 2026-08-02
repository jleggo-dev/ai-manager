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
export type SessionItemTool =
  'read' | 'timer' | 'reps' | 'checkoff' | 'photo' | 'journal' | 'breathing' | 'meditate' | 'grounding';

/** How a block's sets flow (REQ8 slice 2). The catalog (tool-catalog.ts) is the authority for the
 *  names; this type is the shape both it and `SessionBlock.mode` share so they can't drift. */
export type BlockMode = 'straight' | 'circuit';

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
  /** `breathing` only (REQ9 §4.1) — which pattern to play. Unknown ids fall back to the default;
   *  the bank and its safety caps live in breathing.ts, never in coach output. */
  breath_pattern?: string;
  /** `breathing` only — how many cycles. Clamped to the session cap regardless of what's asked. */
  breath_cycles?: number;
  /** `meditate` only (REQ9 §4.2) — which bells ring: none | start_end | interval. */
  meditate_bells?: string;
  /** `meditate` only — minutes between interval bells; ignored unless bells are `interval`. */
  meditate_interval_min?: number;
  /** `grounding` only (REQ9 §4.3) — which game: senses | letters | switch | countback | object | cold. */
  grounding_game?: string;
  /** `grounding` only — the word bank for `letters` (animals | foods | cities). */
  grounding_bank?: string;
}

export interface SessionBlock {
  label: string; // "Warm-up", "Main", "Finisher", "Practice"
  items: SessionItem[];
  /** How this block's sets flow (REQ8 slice 2). 'straight' (default) = each exercise's sets done
   *  consecutively (A,A,B,B); 'circuit' = rotate through the items for `rounds` rounds (A,B,A,B).
   *  The coach chooses per block; absent = straight, so existing sessions are unchanged. */
  mode?: BlockMode;
  rounds?: number; // circuit only — rounds through the items (defaults to the items' max sets)
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
