/* ════════════════════════════════════════════════════════════════
   Deterministic tripwires (§B4) — app code, no LLM
   ════════════════════════════════════════════════════════════════ */

export type Tripwire =
  | 'timezone_shift'
  | 'location_move'
  | 'missed_threshold'
  | 'consistency_outcome_divergence' // was adherence_* — showing up but the outcome isn't moving
  | 'extreme_weather'
  | 'consistency_drop'; // was streak_break — a rolling-window dip, never "you lost your streak"
