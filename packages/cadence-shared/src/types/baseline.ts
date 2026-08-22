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

/** The canonical `GoalArea` values, kept in one place so a Broker-extraction
 *  guard (`isGoalArea`) and any UI area picker never drift from the type above. */
export const GOAL_AREAS: readonly GoalArea[] = ['movement', 'nourishment', 'mind', 'practice'];

/** Narrows an untrusted value (e.g. raw Broker/model output) to a `GoalArea` —
 *  "the app asserts before committing, never trusts raw model output" (see file header). */
export function isGoalArea(value: unknown): value is GoalArea {
  return typeof value === 'string' && (GOAL_AREAS as readonly string[]).includes(value);
}

/**
 * Whether a constraint is bothering them RIGHT NOW ('active') or is a known thing that is
 * currently settled ('quiet' — "my knee's fine at the moment, it only flares if I ramp up too
 * fast"). Absent means they never said, and an unsaid constraint is treated as active: the
 * cautious read is the safe one.
 *
 * This exists because collapsing the two cost a real user his sport. A runner running 5k several
 * times a week said his tendinitis "isn't bothering me right now"; it stored as plan_around only,
 * planning read that as absolute, and running disappeared from his plan entirely. A quiet
 * constraint governs the RAMP RATE — progress sensibly, add prehab — it does not delete work the
 * person is already doing.
 */
export type ConstraintStatus = 'active' | 'quiet';

/**
 * Something the user is working around — physical or not (BRAND.md: "What we work
 * around"). A torn ACL, burnout, grief, and a night shift all fit. `plan_around: true`
 * means the coach must design around it, never ask the user to push through.
 */
export interface Constraint {
  id: string;
  label: string; // e.g. "left knee — patellar tendinopathy", "burnout", "night shifts"
  kind?: 'physical' | 'life' | 'other';
  /** Live today, or quiet-and-known? Absent = they didn't say; readers treat that as 'active'. */
  status?: ConstraintStatus;
  /**
   * YYYY-MM-DD the constraint is known to end, when they said so ("I'm travelling, back Friday").
   * Absent means open-ended. A week away is a real constraint on THIS week and nothing after it,
   * and a plan built for a week someone is not home is a plan built for nobody.
   */
  until?: string;
  plan_around: boolean;
}

export interface WeightTrend {
  current: number;
  start: number;
  source: 'healthkit' | 'manual';
  updated_at: string; // ISO date
}

/**
 * When in the day someone can realistically train/practise. Coarse on purpose: the planner needs
 * a slot, not a clock time, and "mornings, but not before 7" is a constraint, not a preference.
 */
export type TimeOfDay = 'morning' | 'midday' | 'evening' | 'flexible';

export const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'midday', 'evening', 'flexible'];

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return typeof value === 'string' && (TIMES_OF_DAY as readonly string[]).includes(value);
}

/**
 * ONE window the person said they can train or practise in. A slot, plus the clock edge they
 * actually named ("after seven" → earliest "19:00"), because "evening" and "not before 7pm" are
 * different facts and only one of them survives a coarse enum.
 */
export interface AvailabilityWindow {
  part_of_day: TimeOfDay; // 'flexible' as the ONLY window means they said any time works
  earliest?: string; // "HH:MM", only when they gave a clock time
  latest?: string; // "HH:MM", only when they gave a clock time
}

/**
 * When they can train, and for how long — the two halves of availability that a single
 * `time_of_day` enum could not hold.
 *
 * "It varies — I fit it in when I can, but generally early morning and after seven" is TWO
 * windows, not "flexible", and "probably one to two hours" is the size of a session. Both shape
 * every session in the week, and both used to land on the floor.
 *
 * Deliberately NOT a days-per-week figure: how OFTEN is a capacity question answered by what the
 * goal demands and what the person is already doing, never by a number inferred from either.
 */
export interface Availability {
  /** Every window they named. Empty means they haven't said — never a guess. */
  windows: AvailabilityWindow[];
  /** How long ONE session can run, in minutes, as stated ("one to two hours" → {min:60,max:120}).
   *  `max` is absent when they gave a single figure. */
  session_minutes?: { min: number; max?: number };
}

/**
 * ONE span they can eat in. Clock edges only when they gave them — "I eat between noon and eight"
 * is {earliest:"12:00", latest:"20:00"}; "I just skip breakfast" is a span with neither.
 */
export interface EatingWindowSpan {
  /** "HH:MM", only when they named a clock time the fast opens at. */
  earliest?: string;
  /** "HH:MM", only when they named a clock time the fast closes at. */
  latest?: string;
  /**
   * Days this span applies to, as the RRULE codes `scheduling.ts` already parses
   * ('MO'|'TU'|'WE'|'TH'|'FR'|'SA'|'SU'). Absent = every day. Present is how 5:2 and
   * "weekdays only" are expressed — two different days, two different spans.
   */
  days?: string[];
}

/**
 * How someone has chosen to eat — the hours of the day they eat in, not a list of foods.
 *
 * This is NOT a constraint and it is NOT part of `dietary_profile`. `constraints` is "what we work
 * around" and `plan_around: true` starts deleting things; a way of eating is not an impairment.
 * `dietary_profile` is a safety input — hard allergen excludes consumed before anything is
 * suggested — and an eating window excludes no food; parking it there would make the allergen pass
 * defend against a category error.
 *
 * Read by exactly two readers, each through the door it already uses, and that asymmetry is
 * deliberate: the planner sees it inside `<baseline>` (the FASTING/OBSERVANCE clause in
 * `synthesize_plan` drops the meal tasks that fall outside the window — fewer tasks, never
 * rescheduled ones, because a "Log breakfast" card at 13:00 is a lie about what breakfast is), and
 * the coach sees it rendered inside `get_dietary_profile` (retrieval registry), which is what makes
 * it survive compaction and stops her offering breakfast. Do not "tidy" this by moving the field.
 *
 * Nothing here is ever scored. There is deliberately no off-window flag anywhere: a flag exists to
 * be counted, and a count of broken fasts is a scoreboard (BRAND.md — count what happened, never
 * what broke). The coach may notice timing warmly; she may never keep a tally of it.
 */
export interface EatingWindow {
  /** Their words, always — "16:8", "OMAD", "I just skip breakfast", "Ramadan". Never our label. */
  said_as: string;
  /**
   * Empty means they named a pattern we could not turn into clock times. Still keep it: the coach
   * reads `said_as` and can ask. Never a guess.
   */
  windows: EatingWindowSpan[];
  /**
   * YYYY-MM-DD it stops being true, when they said so (Ramadan, a trial month) — same semantics
   * as `Constraint.until`. Absent = open-ended.
   */
  until?: string;
}

/**
 * What they already do, in their own words — the floor a plan builds up from.
 *
 * Cadence prescribed a 45-minute flat WALK to a man who runs 4–5 km several times a week, because
 * "mostly running or other cardio with some body weight exercises" was captured nowhere. Nothing
 * in the schema held it: it is not equipment, not a constraint, and not a goal. A plan that asks
 * for less than someone is already doing is a plan they will close.
 *
 * Their phrasing, volume included ("runs 4–5 k a few times a week"), never a tidied-up summary and
 * never a frequency the app can then treat as a limit.
 */
export interface StartingPoint {
  doing_now: string[];
  /** Direction of travel, only when stated — "I picked it up again these past two weeks". */
  trend?: string;
}

export interface Baseline {
  age?: number;
  /**
   * Only when they say it, never asked as a gate, and absent is a perfectly normal permanent
   * state — plenty of good plans are made without it. It is here because the energy and
   * body-composition formulas take it, so leaving it out of the schema silently degraded every
   * one of them. Anything the two formula inputs don't cover stays absent rather than being
   * squeezed into one of them.
   */
  sex?: 'male' | 'female';
  height_cm?: number;
  /**
   * Availability. Top-level rather than under `preferences` because the baseline is persisted
   * with a shallow jsonb merge, and a nested write would clobber its siblings.
   *
   * `availability` is what capture writes now. `time_of_day` is the older, coarser key: still
   * read by the confirmation card and still editable by hand in the review wizard, and derived
   * from `availability.windows` when there is exactly one window so the two can never disagree.
   */
  time_of_day?: TimeOfDay;
  availability?: Availability;
  /**
   * How they've chosen to eat — the hours, in their words. Top-level for the same reason
   * `availability` is: the baseline persists as a shallow jsonb merge and a nested write would
   * clobber its siblings.
   *
   * ABSENT MEANS THEY NEVER SAID, AND NOTHING MAY INFER IT. This is load-bearing, and it is not a
   * nicety — the `days_per_week` scar below is the same mistake with a smaller blast radius. "He
   * hasn't logged breakfast in nine days, he must be fasting" is a person who was simply busy in
   * the mornings, having breakfast quietly deleted from his plan by a coach who then stops
   * mentioning it. Written when someone says it, or by hand in Settings, or not at all.
   */
  eating_window?: EatingWindow;
  /** What they already do — the floor, not the ceiling. See StartingPoint. */
  starting_point?: StartingPoint;
  /**
   * How many days a week they can honestly give it. 1–7. MANUAL ONLY — the Broker no longer
   * captures this and nothing may infer it.
   *
   * It used to be captured, and it went null → 1 → 2.5 → 2 for a man training for a 50 km
   * ultra: the 1 from "at least once a week", the 2.5 from a device reading back what he was
   * already doing. Both are descriptions of the present, neither is a statement of capacity —
   * and the number then acted as a hard weekly ceiling on his plan. Frequency now comes from
   * what the goal demands, the availability windows above, and observed history.
   */
  days_per_week?: number;
  weight_kg?: WeightTrend; // canonical store (kg); the UOM the user prefers is weight_unit
  weight_unit?: 'kg' | 'lbs';
  /**
   * How often they want to step on the scale (A23 §2c). Weekly is the default and always will be;
   * daily is OPT-IN because a daily number is genuinely hard for some people. It is safe to offer
   * only because the app shows the smoothed TREND rather than the morning's reading — more data
   * makes the trend converge faster without making the user live with the noise.
   */
  weigh_in_cadence?: 'weekly' | 'daily';
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
