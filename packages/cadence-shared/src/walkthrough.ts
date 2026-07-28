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

import type { OccurrenceSession, SessionItem, SessionItemTool } from './types/occurrence.ts';

/* ── The tool catalog ────────────────────────────────────────────────────────────────────────
   Three capture classes (see `stepCaptureMode`):
     • orient  (rings, insight)        — show where you are; write nothing to the log
     • guided  (read, timer, checkoff) — do the thing; the log records only that it happened
     • capture (reps, photo, journal, measure) — emit structured data that BECOMES the log
   `video_query` is a per-step field, not a tool — a how-to link can ride alongside any tool. */
export type StepTool =
  | { kind: 'read' }
  | { kind: 'timer'; seconds: number; chime?: boolean }
  | { kind: 'reps'; sets: number; reps?: number; load?: string }
  | { kind: 'checkoff'; label?: string }
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
    case 'read':
    case 'timer':
    case 'checkoff':
      return 'done';
    case 'reps':
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
  checkoff: 5,
  read: 1,
  photo: 1,
  journal: 3,
  measure: 1,
  rings: 1,
  insight: 1,
};

/** Round a positive minute value; treat missing/≤0 as absent. */
function minutesOf(item: SessionItem, kind: StepToolKind): number {
  const d = item.duration_min;
  if (typeof d === 'number' && d > 0) return Math.round(d);
  return DEFAULT_MINUTES[kind];
}

/**
 * Resolve the tool for one prescribed item. The coach's EXPLICIT `item.tool` wins — it carries the
 * judgment quantities can't (a 1-min plank is a `timer`; a 1-min "find a seat" is a `read`). Only
 * when the coach left it unset do we INFER from quantities: sets → **reps**, duration → **timer**,
 * distance → **checkoff**, else **read** (a cue to follow). Covers movement + practice-area
 * sessions through the same pipe; nutrition/weigh-in/insight tools are attached by the caller.
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
    for (const item of block.items ?? []) {
      const tool = inferTool(item);
      const step: WalkthroughStep = {
        id: `s${steps.length + 1}`,
        title: item.name,
        minutes: minutesOf(item, tool.kind),
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
