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
  | 'read'
  | 'timer'
  | 'interval'
  | 'reps'
  | 'checkoff'
  | 'photo'
  | 'journal'
  | 'breathing'
  | 'meditate'
  | 'grounding'
  | 'feeling_log';

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
  /** `journal` only (REQ9 §4.5) — which question bank to open from. The step shows that bank's
   *  phrasing for today and keeps it with the entry; omit for a blank page. */
  journal_bank?: string;
  /** `interval` only — seconds of the hard effort in ONE round. The load-bearing field: an item
   *  carrying it is an interval step even when the coach forgot the tag. Bounds live in
   *  interval.ts, never in coach output. */
  interval_work_sec?: number;
  /** `interval` only — seconds of the breather in one round. 0 (or absent) makes it EMOM-style:
   *  the chime marks each work start and the rest is whatever is left. */
  interval_recover_sec?: number;
  /** `interval` only — how many work/recover rounds run back to back. Clamped, and trimmed
   *  further if the whole run would exceed the session cap. */
  interval_rounds?: number;
  /** `interval` only — seconds of warm-up BEFORE the rounds (outside them, so never multiplied).
   *  Absent = none, and the player's 5s "get in position" pre-roll takes its job. */
  interval_warmup_sec?: number;
  /** `interval` only — seconds of cool-down after the last round. Absent = none. */
  interval_cooldown_sec?: number;
  /** ANY tool — a pulse to practise to, in quarter-note bpm. Like `video_query` this rides along
   *  with whatever tool the step has rather than being one: a scales step is a timer step that
   *  happens to have a beat. Absent = no metronome, which is the case for almost every step.
   *  Bounds live in metronome.ts, never in coach output. */
  metronome_bpm?: number;
  /** Beats to a bar for the accent (default 4). Ignored unless `metronome_bpm` is set. */
  metronome_meter?: number;
  /** `measure` only — what's being measured ("Weight", "Distance", "Wingspan"). Deliberately NOT
   *  a `SessionItemTool` member (see tool-catalog.ts's exclusion note): the coach never emits this
   *  tool, so these two fields exist only for a client-built activity (or any other direct writer
   *  of an `OccurrenceSession`) to name a numeric-entry step — `inferTool` picks it up from the
   *  fields alone. Absent falls back to the item's own name. */
  measure_metric?: string;
  /** `measure` only — the unit label shown beside the number ("kg", "km", "reps"). Absent = no
   *  unit shown, never a stray blank label. */
  measure_unit?: string;
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
