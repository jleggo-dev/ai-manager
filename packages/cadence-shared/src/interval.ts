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
 * work + recover pair; **rounds** repeat back to back; warm-up and cool-down sit OUTSIDE the
 * rounds, so they are never multiplied. v1 plays one set of rounds — the design's "Add set 2"
 * (a second, differently-shaped block after a rest) is deliberately not built yet.
 */

/** What a phase is for. The player colours the whole frame by this and nothing else: amber means
 *  push, green means breathe, grey means neither. */
export type IntervalPhaseKind = 'work' | 'recover' | 'neutral';

/** One phase of an expanded interval run. */
export interface IntervalPhase {
  kind: IntervalPhaseKind;
  /** User-facing name — "Warm-up", "Work", "Recover", "Cool-down". */
  label: string;
  seconds: number;
  /** 1-based round this phase belongs to. Absent on warm-up/cool-down, which sit outside the rounds. */
  round?: number;
}

/** The whole prescription, as numbers. Everything else in this module is derived from it. */
export interface IntervalPlan {
  /** Runs once, before the rounds. 0 = skipped (the player's 5s "get in position" pre-roll takes over). */
  warmupSec: number;
  workSec: number;
  /** 0 = EMOM-style: the chime marks each work start and you rest inside whatever is left. */
  recoverSec: number;
  rounds: number;
  /** Runs once, after the last round. 0 = skipped. */
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

/** Which template a plan's SET matches, or null for a shape someone built by hand. Warm-up and
 *  cool-down are ignored on purpose — they sit outside the rounds a template describes. */
export function matchTemplate(plan: IntervalPlan): IntervalTemplateId | null {
  const hit = INTERVAL_TEMPLATES.find(
    (t) => t.workSec === plan.workSec && t.recoverSec === plan.recoverSec && t.rounds === plan.rounds,
  );
  return hit ? hit.id : null;
}

/** Apply a template's set to a plan, leaving warm-up and cool-down alone. */
export function applyTemplate(plan: IntervalPlan, id: IntervalTemplateId): IntervalPlan {
  const t = INTERVAL_TEMPLATES.find((x) => x.id === id);
  if (!t) return plan;
  return clampIntervalPlan({ ...plan, workSec: t.workSec, recoverSec: t.recoverSec, rounds: t.rounds });
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
  const workSec = bounded(p.workSec, MIN_WORK_SEC, MAX_WORK_SEC, DEFAULT_WORK_SEC);
  const recoverSec = bounded(p.recoverSec, 0, MAX_RECOVER_SEC, DEFAULT_RECOVER_SEC);
  const warmupSec = bounded(p.warmupSec, 0, MAX_EDGE_SEC, 0);
  const cooldownSec = bounded(p.cooldownSec, 0, MAX_EDGE_SEC, 0);
  const asked = bounded(p.rounds, MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS);
  const perRound = workSec + recoverSec;
  const room = Math.max(0, MAX_INTERVAL_SEC - warmupSec - cooldownSec);
  const byTime = perRound > 0 ? Math.floor(room / perRound) : MAX_ROUNDS;
  const rounds = Math.max(MIN_ROUNDS, Math.min(asked, byTime));
  return { warmupSec, workSec, recoverSec, rounds, cooldownSec };
}

/**
 * Expand a plan into the phases the player walks. A zero-length warm-up, recover or cool-down
 * simply is not there — the ring has no wedge for it and the clock never stops on it, which is
 * exactly how EMOM works without a special case.
 */
export function expandIntervalPhases(plan: IntervalPlan): IntervalPhase[] {
  const p = clampIntervalPlan(plan);
  const phases: IntervalPhase[] = [];
  if (p.warmupSec > 0) phases.push({ kind: 'neutral', label: 'Warm-up', seconds: p.warmupSec });
  for (let r = 1; r <= p.rounds; r += 1) {
    phases.push({ kind: 'work', label: 'Work', seconds: p.workSec, round: r });
    if (p.recoverSec > 0) phases.push({ kind: 'recover', label: 'Recover', seconds: p.recoverSec, round: r });
  }
  if (p.cooldownSec > 0) phases.push({ kind: 'neutral', label: 'Cool-down', seconds: p.cooldownSec });
  return phases;
}

/** Seconds the whole run takes, warm-up and cool-down included. */
export function intervalTotalSeconds(plan: IntervalPlan): number {
  const p = clampIntervalPlan(plan);
  return p.warmupSec + p.rounds * (p.workSec + p.recoverSec) + p.cooldownSec;
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

/** How many rounds have fully ended by `elapsed` — a round ends when the last phase carrying its
 *  number ends. Kept separate so `positionAt` stays readable. */
export function roundsCompleted(phases: readonly IntervalPhase[], elapsed: number): number {
  const endsAt = new Map<number, number>();
  let acc = 0;
  for (const phase of phases) {
    acc += Math.max(0, phase.seconds);
    if (phase.round != null) endsAt.set(phase.round, acc);
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

/** The prescription stated once — "6 × 40/20", or "10 × 1:00" when there is no separate recover. */
export function intervalShorthand(plan: IntervalPlan): string {
  const p = clampIntervalPlan(plan);
  const work = intervalCount(p.workSec);
  return p.recoverSec > 0 ? `${p.rounds} × ${work}/${intervalCount(p.recoverSec)}` : `${p.rounds} × ${work}`;
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
