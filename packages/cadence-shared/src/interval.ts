/* ════════════════════════════════════════════════════════════════
   Intervals — one timer that changes colour (HIIT / EMOM / Tabata)
   ════════════════════════════════════════════════════════════════ */

/**
 * The Movement pillar's answer to the same shape the Mind tools already use: **a plan is a handful
 * of numbers, expanded to an ordered list of phases, played by a clock the renderer owns.** One
 * press of Start runs warm-up → (work / recover) × rounds → cool-down; phases hand over on their
 * own, each with a chime and a colour change. Nothing here knows what HIIT is — a "template" is
 * three numbers, so EMOM (`work 60 / recover 0 × 10`) and Tabata (`20/10 × 8`) fall out of the same
 * machine with no special case.
 *
 * Dependency-free and pure like `breathing.ts` (no clock, no DOM, no DB): `@cadence/api` normalizes
 * coach output with it and `@cadence/web` drives the player with it. `positionAt` is a function of
 * elapsed time rather than accumulated state, so a dropped frame or a backgrounded tab can never
 * desynchronize the ring from the count.
 *
 * **Bounds are enforced here, not trusted to the coach** — the same stance as breathing's safety
 * caps and session-normalize's circuit-round cap. A prescription that would run for two hours is
 * clamped to something a person can actually finish, silently and safely.
 *
 * The vocabulary is one ladder, used in the schema, the player and the UI alike: a **round** is one
 * work + recover pair; a **set** is rounds repeated back to back; warm-up, cool-down and the rest
 * between sets sit OUTSIDE the rounds, so they are never multiplied. A run is one or more sets —
 * a HIIT block then an EMOM finisher — but the COACH only ever prescribes one (see `IntervalPlan`).
 */

/** What a phase is for. The player colours the whole frame by this and nothing else: amber means
 *  push, green means breathe, grey means neither. */
export type IntervalPhaseKind = 'work' | 'recover' | 'neutral';

/** One phase of an expanded interval run. */
export interface IntervalPhase {
  kind: IntervalPhaseKind;
  /** User-facing name — "Warm-up", "Work", "Recover", "Rest", "Cool-down". */
  label: string;
  seconds: number;
  /** 1-based round WITHIN its set. Absent on warm-up, cool-down and the rest between sets — all
   *  three sit outside the rounds, which is why the round count never multiplies them. */
  round?: number;
  /** 1-based set this phase belongs to. Absent for the same three. */
  set?: number;
  /** Globally 1-based across the whole run, so a log can count rounds without knowing about sets. */
  globalRound?: number;
}

/**
 * One set: the work/recover pair and how many times it repeats back to back. The vocabulary ladder
 * the whole tool uses — a **round** is work + recover; a **set** is rounds repeated.
 */
export interface IntervalSet {
  workSec: number;
  /** 0 = EMOM-style: the chime marks each work start and you rest inside whatever is left. */
  recoverSec: number;
  rounds: number;
}

/**
 * The whole prescription, as numbers. Everything else in this module is derived from it.
 *
 * **The coach only ever prescribes ONE set**, and that is deliberate rather than a gap: the flat
 * `interval_*` fields on `SessionItem` describe a single set, because models fill sibling fields
 * far more reliably than nested arrays (REQ9 §7 — the same reason the now-menu flattens its
 * output). A second set is **hand-added in the edit sheet**, which is exactly how the design
 * framed it: "templates describe one set — a second set is always added by hand."
 */
export interface IntervalPlan {
  /** Runs once, before the first set. 0 = skipped (the player's 5s "get in position" pre-roll takes over). */
  warmupSec: number;
  /** At least one. The sheet can add more; the coach never sends more than one. */
  sets: IntervalSet[];
  /** A neutral breather inserted before every set after the first. Ignored when there is one set. */
  restBetweenSetsSec: number;
  /** Runs once, after the last set. 0 = skipped. */
  cooldownSec: number;
}

/* ── Bounds (the coach cannot exceed these; normalize and the player both clamp to them) ────── */

/** Below this a "work" phase is a chime, not an effort. */
export const MIN_WORK_SEC = 5;
/** Past ten minutes of continuous work this is a timer step, not an interval step. */
export const MAX_WORK_SEC = 600;
export const MAX_RECOVER_SEC = 600;
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 20;
/** Fifteen minutes of warm-up or cool-down is already its own step. */
export const MAX_EDGE_SEC = 900;
/** Two shapes back to back is a finisher; past this it is two sessions wearing one hat. */
export const MAX_SETS = 4;
export const DEFAULT_REST_BETWEEN_SETS_SEC = 60;
/** The whole run, warm-up and cool-down included. Rounds are trimmed to fit rather than refused. */
export const MAX_INTERVAL_SEC = 3600;

export const DEFAULT_WORK_SEC = 40;
export const DEFAULT_RECOVER_SEC = 20;
export const DEFAULT_ROUNDS = 6;

/** The interval step's stepper increments — the rep dial's grammar, per row. */
export const WORK_STEP_SEC = 5;
export const EDGE_STEP_SEC = 30;

/**
 * How intervals work, in plain words — shown behind "What's this?" on the card, the same
 * affordance breathing, sitting and grounding use.
 */
export const INTERVAL_HOW =
  'One press of Start runs the whole thing. The screen turns amber when it is time to push and green when it is time to breathe, and a chime marks every handover — so you can put the phone on the floor and work from the colour and the sound. Tap the ring to pause. Stopping early keeps the rounds you actually did.';

/* ── Templates ────────────────────────────────────────────────────────────────────────────────
   Three numbers each, and they seed ONLY the set (work / recover / rounds) — a warm-up someone
   already set is theirs, not the template's. "Custom" is not in this list: it is what the edit
   sheet shows when the numbers match no template, never a mode you switch into. */

export type IntervalTemplateId = 'hiit' | 'emom' | 'tabata';

export interface IntervalTemplate {
  id: IntervalTemplateId;
  label: string;
  /** One line for the coach: when this shape is the right one. */
  summary: string;
  workSec: number;
  recoverSec: number;
  rounds: number;
}

export const INTERVAL_TEMPLATES: readonly IntervalTemplate[] = [
  {
    id: 'hiit',
    label: 'HIIT',
    summary: 'hard effort with a real breather between — the generic default',
    workSec: 40,
    recoverSec: 20,
    rounds: 6,
  },
  {
    id: 'emom',
    label: 'EMOM',
    summary: 'every minute on the minute — one minute of work, no separate recover; you rest inside what is left',
    workSec: 60,
    recoverSec: 0,
    rounds: 10,
  },
  {
    id: 'tabata',
    label: 'Tabata',
    summary: 'twenty on, ten off, eight rounds — four minutes, and it is meant to hurt',
    workSec: 20,
    recoverSec: 10,
    rounds: 8,
  },
];

/** Which template one SET matches, or null for a shape someone built by hand. Warm-up, cool-down
 *  and the rest between sets are ignored on purpose — they sit outside the rounds a template
 *  describes, which is why adding a warm-up doesn't stop something being a Tabata. */
export function matchTemplate(set: IntervalSet | undefined): IntervalTemplateId | null {
  if (!set) return null;
  const hit = INTERVAL_TEMPLATES.find(
    (t) => t.workSec === set.workSec && t.recoverSec === set.recoverSec && t.rounds === set.rounds,
  );
  return hit ? hit.id : null;
}

/** Seed one set from a template, leaving every other set and the edges alone. */
export function applyTemplate(plan: IntervalPlan, setIndex: number, id: IntervalTemplateId): IntervalPlan {
  const t = INTERVAL_TEMPLATES.find((x) => x.id === id);
  if (!t) return plan;
  const sets = plan.sets.map((s, i) =>
    i === setIndex ? { workSec: t.workSec, recoverSec: t.recoverSec, rounds: t.rounds } : s,
  );
  return clampIntervalPlan({ ...plan, sets });
}

/** The plan with one more set on the end, seeded from HIIT. Capped at `MAX_SETS`. */
export function addSet(plan: IntervalPlan): IntervalPlan {
  if (plan.sets.length >= MAX_SETS) return plan;
  const seed = INTERVAL_TEMPLATES[0] ?? {
    workSec: DEFAULT_WORK_SEC,
    recoverSec: DEFAULT_RECOVER_SEC,
    rounds: DEFAULT_ROUNDS,
  };
  const sets = [...plan.sets, { workSec: seed.workSec, recoverSec: seed.recoverSec, rounds: seed.rounds }];
  // The rest row only exists once there is a gap to fill, so it appears with the second set.
  const rest = plan.restBetweenSetsSec > 0 ? plan.restBetweenSetsSec : DEFAULT_REST_BETWEEN_SETS_SEC;
  return clampIntervalPlan({ ...plan, sets, restBetweenSetsSec: rest });
}

/** The plan without set `setIndex`. Removing the last remaining set is a no-op — a run with no
 *  work in it is not a state the player can render, and "delete" should never empty the screen. */
export function removeSet(plan: IntervalPlan, setIndex: number): IntervalPlan {
  if (plan.sets.length <= 1) return plan;
  return clampIntervalPlan({ ...plan, sets: plan.sets.filter((_, i) => i !== setIndex) });
}

/** Replace one set's numbers, clamping the result. */
export function updateSet(plan: IntervalPlan, setIndex: number, patch: Partial<IntervalSet>): IntervalPlan {
  return clampIntervalPlan({
    ...plan,
    sets: plan.sets.map((s, i) => (i === setIndex ? { ...s, ...patch } : s)),
  });
}

/* ── The plan ─────────────────────────────────────────────────────────────────────────────── */

const bounded = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * Coerce anything into a plan that is safe to play. Missing numbers fall back to the HIIT-ish
 * defaults, out-of-range numbers are clamped, and — last — **rounds are trimmed until the whole
 * run fits under the hour cap**, because that is the bound a person actually feels. Always returns
 * at least one round, so a step can never be empty.
 */
export function clampIntervalPlan(plan: Partial<IntervalPlan> | null | undefined): IntervalPlan {
  const p = plan ?? {};
  const warmupSec = bounded(p.warmupSec, 0, MAX_EDGE_SEC, 0);
  const cooldownSec = bounded(p.cooldownSec, 0, MAX_EDGE_SEC, 0);
  const restBetweenSetsSec = bounded(p.restBetweenSetsSec, 0, MAX_EDGE_SEC, DEFAULT_REST_BETWEEN_SETS_SEC);
  const given: Array<Partial<IntervalSet> | undefined> = Array.isArray(p.sets) && p.sets.length > 0 ? p.sets : [{}];
  const sets: IntervalSet[] = given.slice(0, MAX_SETS).map((s) => ({
    workSec: bounded(s?.workSec, MIN_WORK_SEC, MAX_WORK_SEC, DEFAULT_WORK_SEC),
    recoverSec: bounded(s?.recoverSec, 0, MAX_RECOVER_SEC, DEFAULT_RECOVER_SEC),
    rounds: bounded(s?.rounds, MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS),
  }));
  return {
    warmupSec,
    sets: trimToFit(sets, warmupSec, cooldownSec, restBetweenSetsSec),
    restBetweenSetsSec,
    cooldownSec,
  };
}

/**
 * Shave rounds until the whole run fits the hour cap — **from the last set backwards**, because
 * the later sets are the finishers someone bolted on and the first set is the session's point.
 * Never below one round per set: an empty set is not a state the player can render, so the cap is
 * a guardrail here rather than an invariant.
 */
function trimToFit(sets: IntervalSet[], warmupSec: number, cooldownSec: number, restSec: number): IntervalSet[] {
  const edges = warmupSec + cooldownSec + Math.max(0, sets.length - 1) * restSec;
  const out = sets.map((s) => ({ ...s }));
  const body = () => out.reduce((n, s) => n + s.rounds * (s.workSec + s.recoverSec), 0);
  for (let i = out.length - 1; i >= 0 && edges + body() > MAX_INTERVAL_SEC; i -= 1) {
    const set = out[i];
    if (!set) continue;
    const perRound = set.workSec + set.recoverSec;
    if (perRound <= 0) continue;
    const others = body() - set.rounds * perRound;
    const room = MAX_INTERVAL_SEC - edges - others;
    set.rounds = Math.max(MIN_ROUNDS, Math.min(set.rounds, Math.floor(room / perRound)));
  }
  return out;
}

/** The single-set plan the COACH prescribes, from its five flat fields. The only constructor any
 *  caller outside the edit sheet should need. */
export function singleSetPlan(f: {
  warmupSec?: number;
  workSec?: number;
  recoverSec?: number;
  rounds?: number;
  cooldownSec?: number;
}): IntervalPlan {
  return clampIntervalPlan({
    warmupSec: f.warmupSec,
    cooldownSec: f.cooldownSec,
    sets: [{ workSec: f.workSec as number, recoverSec: f.recoverSec as number, rounds: f.rounds as number }],
  });
}

/**
 * Expand a plan into the phases the player walks. A zero-length warm-up, recover, rest or
 * cool-down simply is not there — the ring has no wedge for it and the clock never stops on it,
 * which is exactly how EMOM works without a special case.
 *
 * Rounds are numbered per set for what the player says ("Round 3 of 6" restarts in set 2, because
 * that is how anyone counts), and ALSO globally, so the log can total the work without caring how
 * it was grouped.
 */
export function expandIntervalPhases(plan: IntervalPlan): IntervalPhase[] {
  const p = clampIntervalPlan(plan);
  const phases: IntervalPhase[] = [];
  if (p.warmupSec > 0) phases.push({ kind: 'neutral', label: 'Warm-up', seconds: p.warmupSec });
  let globalRound = 0;
  p.sets.forEach((set, i) => {
    if (i > 0 && p.restBetweenSetsSec > 0) {
      phases.push({ kind: 'neutral', label: 'Rest', seconds: p.restBetweenSetsSec });
    }
    for (let r = 1; r <= set.rounds; r += 1) {
      globalRound += 1;
      const tag = { round: r, set: i + 1, globalRound };
      phases.push({ kind: 'work', label: 'Work', seconds: set.workSec, ...tag });
      if (set.recoverSec > 0) phases.push({ kind: 'recover', label: 'Recover', seconds: set.recoverSec, ...tag });
    }
  });
  if (p.cooldownSec > 0) phases.push({ kind: 'neutral', label: 'Cool-down', seconds: p.cooldownSec });
  return phases;
}

/** Every round in the run, across all sets — what the log counts against. */
export function totalRounds(plan: IntervalPlan): number {
  return clampIntervalPlan(plan).sets.reduce((n, s) => n + s.rounds, 0);
}

/** Seconds the whole run takes, warm-up and cool-down included. */
export function intervalTotalSeconds(plan: IntervalPlan): number {
  const p = clampIntervalPlan(plan);
  const body = p.sets.reduce((n, s) => n + s.rounds * (s.workSec + s.recoverSec), 0);
  const rests = Math.max(0, p.sets.length - 1) * p.restBetweenSetsSec;
  return p.warmupSec + body + rests + p.cooldownSec;
}

/** Whole minutes an interval step occupies, floored at 1 so it never renders as "0 min". */
export function intervalTotalMinutes(plan: IntervalPlan): number {
  return Math.max(1, Math.round(intervalTotalSeconds(plan) / 60));
}

/* ── Where the player is ──────────────────────────────────────────────────────────────────── */

export interface IntervalPosition {
  /** 0-based phase index; equals `phases.length - 1` once finished. */
  index: number;
  phase: IntervalPhase;
  /** The phase that takes over next — absent on the last one, which is how "Next · …" knows to hide. */
  next?: IntervalPhase;
  /** Seconds left in this phase (counts down, never below 0). */
  remaining: number;
  /** Fraction of this phase elapsed, 0→1 — what the current wedge follows. */
  progress: number;
  /** Rounds fully behind you. A round completes when its LAST phase ends, so a run abandoned
   *  mid-work still credits the rounds already finished and never the one in progress. */
  roundsDone: number;
  done: boolean;
}

/**
 * Resolve the player's position from elapsed seconds. Pure — the renderer owns the clock and calls
 * this each tick. Total: an empty phase list yields a finished position rather than throwing.
 */
export function positionAt(phases: readonly IntervalPhase[], elapsed: number): IntervalPosition {
  const empty: IntervalPhase = { kind: 'neutral', label: 'Done', seconds: 0 };
  if (phases.length === 0) {
    return { index: 0, phase: empty, remaining: 0, progress: 1, roundsDone: 0, done: true };
  }
  const t = Math.max(0, elapsed);
  const total = phases.reduce((sum, p) => sum + Math.max(0, p.seconds), 0);
  const last = phases[phases.length - 1] ?? empty;
  if (t >= total) {
    return {
      index: phases.length - 1,
      phase: last,
      remaining: 0,
      progress: 1,
      roundsDone: roundsCompleted(phases, total),
      done: true,
    };
  }
  let acc = 0;
  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i];
    if (!phase) continue;
    const len = Math.max(0, phase.seconds);
    if (t < acc + len) {
      const within = t - acc;
      const position: IntervalPosition = {
        index: i,
        phase,
        remaining: Math.max(0, len - within),
        progress: len > 0 ? Math.min(1, within / len) : 1,
        roundsDone: roundsCompleted(phases, t),
        done: false,
      };
      const next = phases[i + 1];
      if (next) position.next = next;
      return position;
    }
    acc += len;
  }
  return { index: phases.length - 1, phase: last, remaining: 0, progress: 1, roundsDone: 0, done: true };
}

/**
 * How many rounds have fully ended by `elapsed` — a round ends when the last phase carrying its
 * number ends. Keyed on `globalRound`, never `round`: per-set numbering restarts at 1, so keying
 * on that would collapse set 2's round 1 onto set 1's and undercount the whole run.
 */
export function roundsCompleted(phases: readonly IntervalPhase[], elapsed: number): number {
  const endsAt = new Map<number, number>();
  let acc = 0;
  for (const phase of phases) {
    acc += Math.max(0, phase.seconds);
    if (phase.globalRound != null) endsAt.set(phase.globalRound, acc);
  }
  let done = 0;
  for (const end of endsAt.values()) if (elapsed >= end) done += 1;
  return done;
}

/** The elapsed-second mark each phase begins at — where the player fires its chimes. */
export function phaseStartMarks(phases: readonly IntervalPhase[]): number[] {
  const marks: number[] = [];
  let acc = 0;
  for (const phase of phases) {
    marks.push(acc);
    acc += Math.max(0, phase.seconds);
  }
  return marks;
}

/* ── Words ────────────────────────────────────────────────────────────────────────────────── */

/** m:ss for a whole-second count. */
function clock(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** A duration the way the edit sheet and the coach chip say it: bare seconds under a minute
 *  ("40"), m:ss at or above one ("1:00") — so "6 × 40/20" stays as short as the design draws it. */
export function intervalCount(seconds: number): string {
  const t = Math.max(0, Math.round(seconds));
  return t < 60 ? String(t) : clock(t);
}

/** One set, stated the way the coach chip draws it — "6 × 40/20", or "10 × 1:00" when there is no
 *  separate recover (printing "/0" would read as a field someone could copy back). */
export function setShorthand(set: IntervalSet): string {
  const work = intervalCount(set.workSec);
  return set.recoverSec > 0 ? `${set.rounds} × ${work}/${intervalCount(set.recoverSec)}` : `${set.rounds} × ${work}`;
}

/** The whole run, stated once. Two sets read as "6 × 40/20 + 10 × 1:00" — the plus is the rest
 *  between them, which needs no number here because the chip is a summary, not the plan. */
export function intervalShorthand(plan: IntervalPlan): string {
  return clampIntervalPlan(plan).sets.map(setShorthand).join(' + ');
}

/**
 * The one-line receipt an interval step contributes to the occurrence log. **Never the
 * prescription** — pausing out early logs the rounds you actually finished, which is the whole
 * honesty rule of this tool.
 *
 * Takes the run's own numbers rather than a plan, because by the time this is called the plan may
 * no longer exist: someone can edit the intervals before starting, and the receipt has to describe
 * what they ran, not what they were handed. `shorthand` is that run's `intervalShorthand`.
 */
export function intervalLogLine(run: {
  roundsDone: number;
  totalRounds: number;
  elapsedSec: number;
  targetSec: number;
  shorthand: string;
}): string {
  if (run.roundsDone >= run.totalRounds) return `${run.shorthand} · done`;
  const done = Math.max(0, run.roundsDone);
  return `${done} of ${run.totalRounds} rounds · ${clock(run.elapsedSec)} of ${clock(run.targetSec)}`;
}
