/* ════════════════════════════════════════════════════════════════
   Task walkthrough + tool registry (REQ8) — the step→tool projection
   ════════════════════════════════════════════════════════════════ */

/**
 * A task, when tapped, plays as an ordered list of **steps**, each bound to a **tool** the client
 * knows how to render (a timer, a reps counter, a photo capture, a journal box, an insight card…).
 * The coach already composes the prescription (`OccurrenceSession` — blocks of items with
 * sets/reps/load/duration); this module is the pure, presentation-side projection that turns that
 * prescription into a flat, renderable walkthrough. It is DELIBERATELY dependency-free (no DB, no
 * engine, no clock) so both `@cadence/api` and `@cadence/web` can call it — the web needs
 * `condense()` locally to render the "I have less time" version without a round-trip.
 *
 * The tool a step names is chosen from a fixed **catalog** (the union below). Growing the palette =
 * add a variant here + a renderer in the web registry + (later) a catalog line the coach is told
 * about, so it only ever composes from tools that actually exist. See docs/cadence/REQ8.
 */

import type { OccurrenceSession, SessionBlock, SessionItem, SessionItemTool } from './types/occurrence.ts';
import { type BreathPattern, clampCycles, isBreathPatternId, patternById, totalMinutes } from './breathing.ts';
import { type MeditateBells, clampIntervalMinutes, clampSitMinutes, isMeditateBells } from './meditate.ts';
import { type GroundingGame, type GroundingSpec, groundingSpec, isGroundingGame } from './grounding.ts';
import { type JournalBankId, isJournalBankId, journalBank, todaysPhrasing } from './journal.ts';
import { clampFreeWriteMinutes } from './freewrite.ts';
import { type IntervalPlan, intervalTotalMinutes, singleSetPlan } from './interval.ts';

/* ── The tool catalog ────────────────────────────────────────────────────────────────────────
   Three capture classes (see `stepCaptureMode`):
     • orient  (rings, insight)        — show where you are; write nothing to the log
     • guided  (read, timer, checkoff) — do the thing; the log records only that it happened
     • capture (reps, photo, journal, measure) — emit structured data that BECOMES the log
   `video_query` is a per-step field, not a tool — a how-to link can ride alongside any tool. */
/** One exercise in a circuit — the per-round target. `seconds` marks a timed hold (a 60s plank);
 *  otherwise `reps`. The circuit player rotates through these each round. */
export interface CircuitExercise {
  name: string;
  reps?: number;
  load?: string;
  seconds?: number;
  detail?: string;
  video_query?: string;
}

export type StepTool =
  | { kind: 'read' }
  | { kind: 'timer'; seconds: number; chime?: boolean }
  // Intervals — the timer generalised from one phase to a list (warm-up → work/recover × rounds →
  // cool-down), handing over on its own. The already-clamped PLAN travels with the step, not the
  // expanded phases: expansion is deterministic arithmetic the renderer can do (`expandIntervalPhases`),
  // and the edit sheet needs the numbers back anyway to let someone change them before starting.
  | { kind: 'interval'; plan: IntervalPlan }
  | { kind: 'reps'; sets: number; reps?: number; load?: string }
  // A circuit rotates through its exercises for `rounds` rounds (A,B,A,B) — one cohesive step whose
  // ring is the ROUNDS. Straight sets stay as separate `reps` steps (ring = that exercise's sets).
  | { kind: 'circuit'; rounds: number; exercises: CircuitExercise[] }
  | { kind: 'checkoff'; label?: string }
  // Paced breathing (REQ9 §4.1). The resolved pattern travels WITH the step so the renderer stays
  // dumb — it animates `pattern.phases` without knowing any technique's name. `cycles` is already
  // safety-clamped; the renderer never re-derives it.
  | { kind: 'breathing'; pattern: BreathPattern; cycles: number }
  // A held quiet (REQ9 §4.2). Structurally the timer plus bells and the optional "came back" tap —
  // the tap counts returns WITHOUT ever showing a running total, because noticing IS the practice.
  | { kind: 'meditate'; seconds: number; bells: MeditateBells; intervalMin: number }
  // A grounding flow (REQ9 §4.3) — tap-forward cards on the four-zone shell. The whole resolved
  // spec travels with the step so the renderer never looks a game up; it just walks `spec.steps`.
  | { kind: 'grounding'; spec: GroundingSpec }
  // The mind pillar's instrument (REQ9 §4.4). Carries no configuration: the vocabulary is fixed
  // and shared, so the coach chooses WHEN to ask, never what the words are.
  | { kind: 'feeling_log' }
  | { kind: 'photo'; prompt: string; purpose: 'meal' | 'progress' | 'form' }
  // A journal step (REQ9 §4.5). `bank` ties it to a question bank so the kept prompt survives into
  // the store; the entry itself is written on Finish, with the walkthrough's commit rules.
  // `minutes` makes it a timed free-write (REQ9 §4.5): the step runs the same quiet clock the
  // writing page does. The bell never saves here either — the walkthrough commits on Finish.
  | { kind: 'journal'; prompt: string; mode: 'text' | 'voice' | 'either'; bank?: JournalBankId; minutes?: number }
  | { kind: 'measure'; metric: string; unit: string }
  // "Insight tools" — deterministic progress surfaces baked into a task (usually its first step to
  // orient, or the celebration to reward). `source`/`card` name which existing surface to render.
  | { kind: 'rings'; source: 'nutrition' }
  | { kind: 'insight'; card: 'consistency' | 'count' | 'countdown' | 'trend' | 'streak' };

export type StepToolKind = StepTool['kind'];

/** One rendered step. `minutes` is explicit per step (the task total is the SUM — never distribute
 *  evenly when real per-step times exist). `core` marks the load-bearing step the short version
 *  must never drop. `video_query` is a YouTube SEARCH phrase only — the client builds the link. */
export interface WalkthroughStep {
  id: string;
  title: string;
  group?: string; // originating block label ("Warm-up", "Main", "Practice")
  body?: string; // the walkthrough copy / cue shown under the title
  minutes: number;
  tool: StepTool;
  video_query?: string;
  skippable: boolean;
  core?: boolean;
}

export interface Walkthrough {
  steps: WalkthroughStep[];
  total_min: number;
}

export type StepCaptureMode = 'none' | 'done' | 'structured';

/** What a step contributes to the occurrence log when completed — the capture contract that lets
 *  the walkthrough replace the old free-text "how did it go?" without losing the adaptation signal:
 *  a reps step emits sets/reps/load, a photo step emits the meal, a journal step emits the note. */
export function stepCaptureMode(tool: StepTool): StepCaptureMode {
  switch (tool.kind) {
    case 'rings':
    case 'insight':
      return 'none';
    // `breathing` and `meditate` sit here deliberately: they capture nothing structured — the log
    // records the rounds or the minutes you did, never anything about the person.
    case 'read':
    case 'timer':
    case 'interval':
    case 'checkoff':
    case 'breathing':
    case 'meditate':
    case 'grounding':
      return 'done';
    // A feeling note IS the capture — a word and how much room it's taking become the log.
    case 'feeling_log':
      return 'structured';
    case 'reps':
    case 'circuit':
    case 'photo':
    case 'journal':
    case 'measure':
      return 'structured';
    default: {
      const _exhaustive: never = tool;
      void _exhaustive;
      return 'done';
    }
  }
}

const DEFAULT_MINUTES: Record<StepToolKind, number> = {
  timer: 1, // timer items always carry a real duration; this is only a floor
  interval: 9, // an interval run computes its real minutes from the plan; this is only a floor
  reps: 3,
  circuit: 8, // circuits compute their own minutes (rounds × items); this is only a floor
  checkoff: 5,
  read: 1,
  photo: 1,
  journal: 3,
  measure: 1,
  breathing: 1, // breathing computes its real minutes from pattern × cycles; this is only a floor
  meditate: 10, // a sit carries its own duration; this is only a floor
  grounding: 3, // a grounding flow has no required length — this is a nominal slot on the trail
  feeling_log: 1, // twenty seconds, every time
  rings: 1,
  insight: 1,
};

/** Round a positive minute value; treat missing/≤0 as absent. A breathing step ignores any stated
 *  duration — its real length is pattern × clamped cycles, which is arithmetic, not a guess. */
function minutesOf(item: SessionItem, tool: StepTool): number {
  if (tool.kind === 'breathing') return totalMinutes(tool.pattern, tool.cycles);
  if (tool.kind === 'meditate') return Math.max(1, Math.round(tool.seconds / 60));
  // Same rule as breathing: an interval run's length is arithmetic over its own numbers, so a
  // `duration_min` the coach also wrote down is ignored rather than allowed to contradict the ring.
  if (tool.kind === 'interval') return intervalTotalMinutes(tool.plan);
  const d = item.duration_min;
  if (typeof d === 'number' && d > 0) return Math.round(d);
  return DEFAULT_MINUTES[tool.kind];
}

/** A journal step. A named bank supplies today's phrasing (rotating, deterministic) unless the
 *  coach wrote its own question in `detail` — their sentence always wins. */
function journalTool(item: SessionItem): StepTool {
  const bank = isJournalBankId(item.journal_bank) ? item.journal_bank : undefined;
  const banked = bank ? journalBank(bank) : undefined;
  // Last resort, and deliberately practice-neutral. The coach is told to always send a bank or its
  // own question, but when it sends neither this line still has to work for a novelist, a student
  // and someone with a devotional practice alike — "jot down how it went" (the old default)
  // presumed a workout had just happened and read as nonsense on a study or free-writing step.
  const prompt =
    item.detail ??
    (banked ? todaysPhrasing(banked, new Date().toISOString().slice(0, 10)) : 'What do you want to write?');
  // The catalog tells the coach `duration_min` makes this a timed free-write, so the step has to
  // honour it. Dropping it here is how the ＋ menu ran a clock and a session step silently didn't.
  const minutes = typeof item.duration_min === 'number' ? clampFreeWriteMinutes(item.duration_min) : undefined;
  return { kind: 'journal', prompt, mode: 'either', ...(bank ? { bank } : {}), ...(minutes ? { minutes } : {}) };
}

/** A grounding flow from the item's game + bank. An unknown game degrades to the senses sweep
 *  rather than breaking the step. */
function groundingTool(item: SessionItem): StepTool {
  const game: GroundingGame = isGroundingGame(item.grounding_game) ? item.grounding_game : 'senses';
  return { kind: 'grounding', spec: groundingSpec(game, item.grounding_bank) };
}

/** A sit from the item's duration + bell settings, bounded here so every consumer gets a valid
 *  step. An unknown bell name falls back to a plain start/end pair rather than silence. */
function meditateTool(item: SessionItem): StepTool {
  const minutes = clampSitMinutes(item.duration_min);
  const bells: MeditateBells = isMeditateBells(item.meditate_bells) ? item.meditate_bells : 'start_end';
  return {
    kind: 'meditate',
    seconds: minutes * 60,
    bells,
    intervalMin: clampIntervalMinutes(minutes, item.meditate_interval_min),
  };
}

/** An interval run from the item's five numbers, clamped here so every consumer gets a plan that
 *  is safe to play (and a run that fits inside an hour). */
function intervalTool(item: SessionItem): StepTool {
  return {
    kind: 'interval',
    // The coach's five flat fields describe ONE set; a second set is hand-added in the edit sheet.
    plan: singleSetPlan({
      warmupSec: item.interval_warmup_sec,
      workSec: item.interval_work_sec,
      recoverSec: item.interval_recover_sec,
      rounds: item.interval_rounds,
      cooldownSec: item.interval_cooldown_sec,
    }),
  };
}

/** A breathing tool from the item's pattern/cycles, resolved and safety-clamped here so every
 *  consumer gets an already-valid step (an unknown pattern degrades to the default, never breaks). */
function breathingTool(item: SessionItem): StepTool {
  const pattern: BreathPattern = patternById(item.breath_pattern);
  return { kind: 'breathing', pattern, cycles: clampCycles(pattern, item.breath_cycles) };
}

/**
 * Resolve the tool for one prescribed item. The coach's EXPLICIT `item.tool` wins — it carries the
 * judgment quantities can't (a 1-min plank is a `timer`; a 1-min "find a seat" is a `read`). Only
 * when the coach left it unset do we infer — and **tool-specific fields outrank quantities**,
 * because they are unambiguous where quantities never were: `journal_bank` can only mean journal,
 * `grounding_game` only grounding, `meditate_bells` only meditate, `breath_pattern` only breathing,
 * `interval_work_sec` only intervals. Quantities come after: sets → **reps**, duration → **timer**,
 * distance → **checkoff**, else **read**. The catalog's preamble tells the coach `tool: null` is safe; this ordering is what
 * makes that sentence true — before it, a journal item with a duration and no tag silently became
 * a bare timer, and a bank with no duration became `read` (the widget vanished entirely).
 *
 * Bare `duration_min` still means timer, never breathing or intervals — "5 minutes of breathing",
 * "5 minutes of sprints" and "a 5-min hold" are indistinguishable from a duration alone. An
 * explicit `breath_pattern` or `interval_work_sec` is not a quantity, so inferring from those
 * keeps that rule intact.
 */
export function inferTool(item: SessionItem): StepTool {
  if (item.tool) return toolFromKind(item.tool, item);
  if (isJournalBankId(item.journal_bank)) return journalTool(item);
  if (typeof item.interval_work_sec === 'number' && item.interval_work_sec > 0) return intervalTool(item);
  if (isGroundingGame(item.grounding_game)) return groundingTool(item);
  if (isMeditateBells(item.meditate_bells)) return meditateTool(item);
  if (isBreathPatternId(item.breath_pattern)) return breathingTool(item);
  if (typeof item.sets === 'number' && item.sets > 0) return repsTool(item);
  if (typeof item.duration_min === 'number' && item.duration_min > 0) {
    return { kind: 'timer', seconds: Math.round(item.duration_min * 60), chime: true };
  }
  if (typeof item.distance_km === 'number' && item.distance_km > 0) {
    return { kind: 'checkoff', label: `${item.distance_km} km` };
  }
  return { kind: 'read' };
}

/** A reps tool from an item's sets/reps/load. `sets` floors at 1 for an explicit-but-unquantified pick. */
function repsTool(item: SessionItem): StepTool {
  return {
    kind: 'reps',
    sets: typeof item.sets === 'number' && item.sets > 0 ? item.sets : 1,
    ...(item.reps != null ? { reps: item.reps } : {}),
    ...(item.load ? { load: item.load } : {}),
  };
}

/** Build the coach's explicitly-chosen tool, pulling its config from the item's own fields. */
function toolFromKind(kind: SessionItemTool, item: SessionItem): StepTool {
  switch (kind) {
    case 'timer':
      return { kind: 'timer', seconds: item.duration_min ? Math.round(item.duration_min * 60) : 60, chime: true };
    case 'interval':
      return intervalTool(item);
    case 'reps':
      return repsTool(item);
    case 'checkoff':
      return item.distance_km ? { kind: 'checkoff', label: `${item.distance_km} km` } : { kind: 'checkoff' };
    case 'photo':
      return { kind: 'photo', prompt: item.detail ?? 'Take a photo', purpose: 'progress' };
    case 'journal':
      return journalTool(item);
    case 'breathing':
      return breathingTool(item);
    case 'meditate':
      return meditateTool(item);
    case 'grounding':
      return groundingTool(item);
    case 'feeling_log':
      return { kind: 'feeling_log' };
    case 'read':
      return { kind: 'read' };
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return { kind: 'read' };
    }
  }
}

/**
 * Project an `OccurrenceSession` into a flat, renderable `Walkthrough`. Each prescribed item
 * becomes one step (keeping its block label as `group`), the tool is inferred from the item's
 * quantities, per-step minutes come from the item (or a per-tool floor), and the single
 * longest step is flagged `core`. Pure and total — no session → an empty walkthrough.
 */
export function deriveWalkthrough(session: OccurrenceSession | null | undefined): Walkthrough {
  const steps: WalkthroughStep[] = [];
  for (const block of session?.blocks ?? []) {
    const items = block.items ?? [];
    // A circuit block becomes ONE step that rotates its items; a straight block stays one step per item.
    if (block.mode === 'circuit' && items.length > 0) {
      steps.push(circuitStep(block, items, steps.length));
      continue;
    }
    for (const item of items) {
      const tool = inferTool(item);
      const step: WalkthroughStep = {
        id: `s${steps.length + 1}`,
        title: item.name,
        minutes: minutesOf(item, tool),
        tool,
        skippable: true,
      };
      if (block.label) step.group = block.label;
      if (item.detail) step.body = item.detail;
      if (item.video_query) step.video_query = item.video_query;
      steps.push(step);
    }
  }
  flagCore(steps);
  return { steps, total_min: steps.reduce((sum, s) => sum + s.minutes, 0) };
}

/**
 * Project a circuit block into ONE step whose tool rotates the items for `rounds` rounds. Rounds
 * default to the items' max `sets` (so "2×15 / 2×60s" reads as 2 rounds). Minutes ≈ rounds × the
 * per-round time (each item's duration, or a 1-min floor for a rep set). A timed item (a 60s plank)
 * carries `seconds`; otherwise `reps`.
 */
function circuitStep(block: SessionBlock, items: SessionItem[], index: number): WalkthroughStep {
  const maxSets = items.reduce((m, i) => Math.max(m, typeof i.sets === 'number' && i.sets > 0 ? i.sets : 1), 1);
  const rounds = typeof block.rounds === 'number' && block.rounds > 0 ? block.rounds : maxSets;
  const exercises: CircuitExercise[] = items.map((i) => ({
    name: i.name,
    ...(i.reps != null ? { reps: i.reps } : {}),
    ...(i.load ? { load: i.load } : {}),
    ...(i.duration_min && i.duration_min > 0 ? { seconds: Math.round(i.duration_min * 60) } : {}),
    ...(i.detail ? { detail: i.detail } : {}),
    ...(i.video_query ? { video_query: i.video_query } : {}),
  }));
  const perRound = items.reduce((n, i) => n + (i.duration_min && i.duration_min > 0 ? i.duration_min : 1), 0);
  const step: WalkthroughStep = {
    id: `s${index + 1}`,
    title: block.label || 'Circuit',
    minutes: Math.max(1, Math.round(rounds * perRound)),
    tool: { kind: 'circuit', rounds, exercises },
    skippable: true,
  };
  if (block.label) step.group = block.label;
  return step;
}

/** Mark the single longest step (first on a tie) as the load-bearing `core`. */
function flagCore(steps: WalkthroughStep[]): void {
  let core: WalkthroughStep | undefined;
  for (const step of steps) {
    if (!core || step.minutes > core.minutes) core = step;
  }
  if (core) core.core = true;
}

/**
 * The "I have less time" version. Rule (from the redesign spec): keep the **setup** step plus the
 * **core** (longest) step at HALF its duration (min 2 min); if the task has ≤2 steps, keep them
 * all. The core is never dropped — a condensed run must still contain the run. Deterministic; a
 * 4-step run [3,2,20,5] condenses to [warm-up 3, run 10] = 13 min.
 */
export function condense(w: Walkthrough): Walkthrough {
  const steps = w.steps;
  const setup = steps[0];
  if (steps.length <= 2 || !setup) return { steps: steps.map((s) => ({ ...s })), total_min: w.total_min };

  const core = steps.find((s) => s.core) ?? steps.reduce((a, b) => (b.minutes > a.minutes ? b : a), setup);
  const halvedCore: WalkthroughStep = { ...core, minutes: Math.max(2, Math.round(core.minutes / 2)) };

  const kept: WalkthroughStep[] = setup.id === core.id ? [halvedCore] : [{ ...setup }, halvedCore];
  return { steps: kept, total_min: kept.reduce((sum, s) => sum + s.minutes, 0) };
}
