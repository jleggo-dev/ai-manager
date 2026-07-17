/**
 * @cadence/shared — Cadence domain types.
 *
 * Source of truth: cadence-spec.md §5 (data model) and §C4 (Broker job
 * contracts). IDs are app-generated. The Broker extracts into these shapes;
 * the app asserts them before committing (never trust raw model output).
 */

/* ════════════════════════════════════════════════════════════════
   §5.1 User & baseline
   ════════════════════════════════════════════════════════════════ */

/**
 * Life areas a goal can live in (BRAND.md nomenclature). Every kind of goal gets a
 * first-class home day one: a Spartan race (movement), better meals (nourishment),
 * burnout recovery (mind), daily prayer or morning pages (practice). Broaden by enum
 * ADDITION only (craft, spirit, learning) — never a migration. 'weight' is not an area:
 * a weight target is a numeric measure.target on a goal, not an area of life.
 */
export type GoalArea = 'movement' | 'nourishment' | 'mind' | 'practice';

/**
 * Something the user is working around — physical or not (BRAND.md: "What we work
 * around"). A torn ACL, burnout, grief, and a night shift all fit. `plan_around: true`
 * means the coach must design around it, never ask the user to push through.
 */
export interface Constraint {
  id: string;
  label: string; // e.g. "left knee — patellar tendinopathy", "burnout", "night shifts"
  kind?: 'physical' | 'life' | 'other';
  plan_around: boolean;
}

export interface WeightTrend {
  current: number;
  start: number;
  source: 'healthkit' | 'manual';
  updated_at: string; // ISO date
}

export interface Baseline {
  age?: number;
  height_cm?: number;
  weight_kg?: WeightTrend; // canonical store (kg); the UOM the user prefers is weight_unit
  weight_unit?: 'kg' | 'lbs';
  height_unit?: 'cm' | 'ft'; // canonical store is always height_cm; this is the display UOM
  /** Unified "what we work around" list — replaces the old injuries[] + free-text constraints[]. */
  constraints: Constraint[];
  preferences: {
    dietary?: string[];
    nudge_tone?: 'warm' | 'neutral' | 'firm';
  };
}

export interface Connection {
  source: 'apple_health' | string;
  scopes: string[];
  status: 'connected' | 'disconnected';
}

export interface SteerBack {
  aggressivity: 'gentle' | 'balanced' | 'firm';
  missed_threshold: number;
}

export interface UserProfile {
  user_id: string;
  name: string;
  /** Coarse home location captured at onboarding (§B1), permission-gated. */
  home_location?: { lat: number; lon: number; label?: string };
  timezone?: string;
  baseline: Baseline;
  connections: Connection[];
  steer_back: SteerBack;
}

/* ════════════════════════════════════════════════════════════════
   §5.2 Goal
   ════════════════════════════════════════════════════════════════ */

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
  confidence?: number; // Broker extraction confidence
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

/* ════════════════════════════════════════════════════════════════
   §5.3 Equipment (with shoe mileage)
   ════════════════════════════════════════════════════════════════ */

export type EquipmentCategory =
  | 'footwear'
  | 'cardio'
  | 'strength'
  | 'accessory'
  | 'reading'
  | 'practice' // a mat, cushion, instrument — things a mind/practice goal is done with
  | 'craft' // art/creative supplies
  | 'study' // learning materials, courses
  | 'other';

export interface EquipmentWear {
  tracks_mileage: boolean;
  accumulated_km: number;
  threshold_km: number;
  auto_sum_from: 'healthkit_runs' | string;
  status: 'active' | 'retire_soon' | 'retired';
}

export interface Equipment {
  equipment_id: string;
  name: string;
  category: EquipmentCategory;
  owned: boolean;
  recommended_by: 'ai' | null;
  linked_goal_ids: string[];
  wear?: EquipmentWear; // footwear only
}

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

/* ════════════════════════════════════════════════════════════════
   §5.5 Occurrence / completion log  (+ §B1 weather)
   ════════════════════════════════════════════════════════════════ */

export type OccurrenceStatus = 'pending' | 'done' | 'skipped' | 'missed';

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

/* ── Progress module (deterministic; LLM never computes numbers) ─────────────── */

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

/** One dashboard card. The KIND union is the whole "coach-defined dashboard" contract:
 *  which cards exist derives from the user's actual goals + logged data (variable content,
 *  stable renderer); an LLM spec layer can later emit the same shapes. */
export type ProgressCard =
  | { kind: 'latest_vs_target'; area: GoalArea; title: string; unit: string; latest: number | null; start: number | null; target: number; series: SeriesPoint[] }
  | { kind: 'count'; area: GoalArea; title: string; goal_id: string; current: number; target: number; unit: string }
  | { kind: 'countdown'; area: GoalArea; title: string; end: string; days_left: number; milestones_done: number; milestones_total: number }
  | { kind: 'consistency'; area: GoalArea; title: string; kept: number; window: number };

/** A per-activity trend derived from session logs (pace, top load). */
export interface ProgressTrend {
  title: string; // activity title (the cross-plan history key)
  metric: 'pace_min_per_km' | 'top_load_kg' | 'distance_km' | 'duration_min';
  label: string; // human: "Pace", "Top load"
  unit: string;
  series: SeriesPoint[];
  direction_good: 'down' | 'up'; // pace down = better; load up = better
}

export interface HistoryEntry {
  at: string; // ISO or YYYY-MM-DD
  kind: 'session' | 'event';
  title: string; // activity title or event label
  detail: string; // log summary or event context
}

export interface ProgressData {
  cards: ProgressCard[];
  trends: ProgressTrend[];
  history: HistoryEntry[];
}

/** A countable, dated accomplishment ("finished Dune") — powers count-goal progress (20/100)
 *  and the History feed. goal_id nullable: deleting a goal never erases history. */
export interface GoalEvent {
  event_id: string;
  user_id: string;
  goal_id?: string | null;
  kind: 'completion' | 'note';
  label: string;
  at: string;
  meta?: Record<string, unknown> | null;
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
}

/* ════════════════════════════════════════════════════════════════
   §5.6 Nutrition  (+ §B2 macro targets)
   ════════════════════════════════════════════════════════════════ */

export interface Macros {
  kcal?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  /** Who produced these numbers: AI estimate ('ai') or the user's own correction ('user'). */
  source?: 'ai' | 'user';
}

export type MealKind = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink' | 'other';

export interface NutritionLog {
  log_id: string;
  date: string;
  meal: MealKind;
  items: { name: string; qty?: number; unit?: string; est?: Macros }[];
  macros: Macros;
  input_method: 'photo' | 'voice' | 'text' | 'manual';
  ai_confidence?: number;
  /** Below `confirm_below_confidence` the value is provisional and excluded from totals (§B2). */
  provisional?: boolean;
  photo_ref?: string;
  raw_text?: string | null; // the user's own words — always kept (0013)
  flags?: { alcohol?: boolean; caffeine?: boolean }; // ONLY from explicit mentions, never inferred (0013)
  photo_url?: string | null; // display-only: short-lived signed URL attached at read time (never stored)
}

/** Deterministic Observe-phase read over nutrition_logs — the coach's food-log summary. */
export interface NutritionSummary {
  window_days: number;
  days_logged: number; // distinct dates — the module arc's PHASE SIGNAL (~7 → baseline ready)
  meals_logged: number;
  meals_per_logged_day: number; // rounded 0.1
  top_items: { name: string; count: number }[]; // ≤5
  alcohol_days: number;
  caffeine_days: number;
}

export interface MacroTargets {
  kcal?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  confirm_below_confidence?: number; // provisional threshold; defaults to 0.5 in nutrition.ts when unset
}

export interface Recipe {
  recipe_id: string;
  name: string;
  source: 'user' | 'ai_from_fridge_photo' | 'ai';
  servings: number;
  ingredients: { name: string; qty: number | string }[];
  steps: string[];
  macros_per_serving: Macros;
  tags: string[];
  saved: boolean;
}

export interface ShoppingListItem {
  name: string;
  qty: string;
  category: string;
  checked: boolean;
}

export interface MealPlan {
  meal_plan_id: string;
  week_of: string;
  days: { day: string; meals: { slot: string; recipe_id: string }[] }[];
  shopping_list: ShoppingListItem[];
}

/* ════════════════════════════════════════════════════════════════
   §5.7 Disrupted episode
   ════════════════════════════════════════════════════════════════ */

export interface EpisodeOverride {
  activity_id: string;
  swap_to?: string;
  action?: 'pause';
}

/**
 * A disrupted episode is an ADDITIVE temporary overlay, not a rewrite of the base
 * plan (user direction): it makes space to "do what you can" guilt-free, protects
 * momentum (a detour never resets progress to zero), and the base plan resumes
 * untouched on `end`. `type: 'custom'` covers
 * non-fitness life events (a wedding, a bereavement) where tone matters more than
 * equipment. `available_equipment` is confirmed for the episode — e.g. the user
 * photographs a hotel gym and the Broker/Coach parses it into equipment.
 */
export interface DisruptedEpisode {
  episode_id: string;
  type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
  start: string;
  end: string;
  /** Equipment available only during the episode (e.g. from a hotel-gym photo). */
  available_equipment?: Partial<Equipment>[];
  constraints: Record<string, unknown>;
  /** Optional lighter temporary activities for the episode — added, not substituted. */
  temp_activities?: Partial<Activity>[];
  /** Per-base-activity tweaks (swap/pause) while the episode is active. */
  overrides: EpisodeOverride[];
  /** Momentum is protected (progress never resets) and nudge tone softened while active. */
  protect_momentum: boolean;
  tone?: 'gentle' | 'supportive';
  status: 'active' | 'ended';
}

/* ════════════════════════════════════════════════════════════════
   §C6 Conversation mapping (Cadence conversation_id → AI Admin session)
   ════════════════════════════════════════════════════════════════ */

export interface Conversation {
  conversation_id: string;
  user_id: string;
  ai_session_id: string; // AI Admin chat-session id
  external_chat_id: string | null; // provider chat id (Devs.ai)
  rolling_summary?: string;
  token_estimate?: number;
  created_at: string;
  updated_at?: string; // bumped on message activity — feeds the idle-staleness rule
}

/* ════════════════════════════════════════════════════════════════
   §C4 Broker job contracts — flat top-level JSON. Assert app-side.
   ════════════════════════════════════════════════════════════════ */

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

/** A situation_assess recommendation awaiting the user's accept/dismiss — never auto-applied
 *  (suggest-never-auto-apply, BRAND.md's autonomy stance). Stored per-user until resolved. */
export interface PendingProposal {
  reason: string;
  suggested_levers: string[];
  created_at: string;
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
