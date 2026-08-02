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
import { type BreathPattern, clampCycles, patternById, totalMinutes } from './breathing.ts';
import { type MeditateBells, clampIntervalMinutes, clampSitMinutes, isMeditateBells } from './meditate.ts';

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
  | { kind: 'photo'; prompt: string; purpose: 'meal' | 'progress' | 'form' }
  | { kind: 'journal'; prompt: string; mode: 'text' | 'voice' | 'either' }
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
    case 'checkoff':
    case 'breathing':
    case 'meditate':
      return 'done';
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
  reps: 3,
  circuit: 8, // circuits compute their own minutes (rounds × items); this is only a floor
  checkoff: 5,
  read: 1,
  photo: 1,
  journal: 3,
  measure: 1,
  breathing: 1, // breathing computes its real minutes from pattern × cycles; this is only a floor
  meditate: 10, // a sit carries its own duration; this is only a floor
  rings: 1,
  insight: 1,
};

/** Round a positive minute value; treat missing/≤0 as absent. A breathing step ignores any stated
 *  duration — its real length is pattern × clamped cycles, which is arithmetic, not a guess. */
function minutesOf(item: SessionItem, tool: StepTool): number {
  if (tool.kind === 'breathing') return totalMinutes(tool.pattern, tool.cycles);
  if (tool.kind === 'meditate') return Math.max(1, Math.round(tool.seconds / 60));
  const d = item.duration_min;
  if (typeof d === 'number' && d > 0) return Math.round(d);
  return DEFAULT_MINUTES[tool.kind];
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

/** A breathing tool from the item's pattern/cycles, resolved and safety-clamped here so every
 *  consumer gets an already-valid step (an unknown pattern degrades to the default, never breaks). */
function breathingTool(item: SessionItem): StepTool {
  const pattern: BreathPattern = patternById(item.breath_pattern);
  return { kind: 'breathing', pattern, cycles: clampCycles(pattern, item.breath_cycles) };
}

/**
 * Resolve the tool for one prescribed item. The coach's EXPLICIT `item.tool` wins — it carries the
 * judgment quantities can't (a 1-min plank is a `timer`; a 1-min "find a seat" is a `read`). Only
 * when the coach left it unset do we INFER from quantities: sets → **reps**, duration → **timer**,
 * distance → **checkoff**, else **read** (a cue to follow). Covers movement + practice-area
 * sessions through the same pipe; nutrition/weigh-in/insight tools are attached by the caller.
 *
 * `breathing` is NEVER inferred — a duration means a timer. Paced breathing is only ever played
 * when the coach explicitly asks for it, because "5 minutes of breathing" and "a 5-minute hold"
 * are indistinguishable from quantities alone.
 */
export function inferTool(item: SessionItem): StepTool {
  if (item.tool) return toolFromKind(item.tool, item);
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
    case 'reps':
      return repsTool(item);
    case 'checkoff':
      return item.distance_km ? { kind: 'checkoff', label: `${item.distance_km} km` } : { kind: 'checkoff' };
    case 'photo':
      return { kind: 'photo', prompt: item.detail ?? 'Take a photo', purpose: 'progress' };
    case 'journal':
      return { kind: 'journal', prompt: item.detail ?? 'Jot down how it went', mode: 'either' };
    case 'breathing':
      return breathingTool(item);
    case 'meditate':
      return meditateTool(item);
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
