/* ════════════════════════════════════════════════════════════════
   The coach's TOOL CATALOG — one source of truth (REQ8 harness)
   ════════════════════════════════════════════════════════════════ */

/**
 * The single authority for the tools the **coach** may compose a session from. The problem this
 * solves: the coach runs on devs.ai and only knows what its prompt tells it, while the client can
 * only render the `StepTool` variants it has code for and the api only accepts a whitelist — three
 * lists that used to be hand-kept in three files and drift apart. This module makes them ONE:
 *
 *   • `COACH_TOOLS` is typed `Record<SessionItemTool, …>` — adding a coach tool is a COMPILE ERROR
 *     until it has a catalog entry here.
 *   • `renderCoachToolCatalog()` renders it to the hierarchical block injected into prescribe-session
 *     as the `{{tool_catalog}}` variable (session-generate.ts) — so the coach's prompt is always
 *     exactly this catalog, with no re-sync (see docs/cadence/PLAN.md § "Tool catalog").
 *   • `SESSION_TOOL_KINDS` / `BLOCK_MODE_KINDS` are the api's whitelist (session-normalize.ts).
 *   • the `never` guard at the bottom fails to compile unless every coach tool also has a client
 *     `StepTool` renderer in walkthrough.ts.
 *
 * NOT here on purpose: `measure` (the weigh-in), `rings`, and `insight` are app-attached surfaces,
 * not things the coach emits — they live only in walkthrough.ts's `StepTool`.
 */

import type { BlockMode, SessionItemTool } from './types/occurrence.ts';
import type { StepToolKind } from './walkthrough.ts';
import { BREATH_PATTERNS, patternCounts } from './breathing.ts';
import { DEFAULT_SIT_MINUTES, MAX_SIT_MINUTES, MEDITATE_BELL_KINDS } from './meditate.ts';
import { GROUNDING_GAMES, GROUNDING_NAMES } from './grounding.ts';

/** The `SessionItem` quantity/detail fields a tool reads — named so the coach fills the right ones. */
export type ItemField =
  | 'sets'
  | 'reps'
  | 'load'
  | 'duration_min'
  | 'distance_km'
  | 'detail'
  | 'breath_pattern'
  | 'breath_cycles'
  | 'meditate_bells'
  | 'meditate_interval_min'
  | 'grounding_game'
  | 'grounding_bank';

/** Capture class (mirrors `stepCaptureMode`): `guided` = do it, log records only that it happened;
 *  `capture` = the person emits data that BECOMES the log. */
export type ToolClass = 'guided' | 'capture';

export interface CoachToolSpec {
  class: ToolClass;
  /** One line: what the tool is and when to pick it — the coach reads this to choose. */
  summary: string;
  /** The judgment quantities can't carry — the trap to avoid (e.g. duration ≠ timer). */
  notWhen?: string;
  /** Which item fields to fill for this tool. */
  reads: ItemField[];
  /** A concrete example item the coach can pattern-match. */
  example: Record<string, unknown>;
}

/**
 * THE catalog. Order is intentional (read first as the default, then the rest of guided, then
 * capture) — `renderCoachToolCatalog` preserves it. Typed as a total Record so nothing is missing.
 */
export const COACH_TOOLS: Record<SessionItemTool, CoachToolSpec> = {
  read: {
    class: 'guided',
    summary: 'a cue to read and follow, capturing nothing — THE DEFAULT when nothing interactive fits',
    reads: ['detail'],
    example: { name: 'Settle in', tool: 'read', detail: 'Find a comfortable seat, shoulders soft' },
  },
  timer: {
    class: 'guided',
    summary:
      'the passage of time itself IS the task — a held or timed effort you watch a clock for (a 1-min plank, a 5-min meditation, a 20-min zone-2 run)',
    notWhen:
      'do NOT pick timer just because a step has a duration — "a minute to settle in" has a duration but is read',
    reads: ['duration_min'],
    example: { name: 'Forearm plank', tool: 'timer', duration_min: 1 },
  },
  checkoff: {
    class: 'guided',
    summary: 'do-it-and-confirm with nothing to capture — a distance target, "step outside", a mobility drill',
    reads: ['distance_km', 'detail'],
    example: { name: 'Easy shakeout jog', tool: 'checkoff', distance_km: 3 },
  },
  breathing: {
    class: 'guided',
    summary:
      'paced breathing — the app runs the rhythm and they follow it. Pick a pattern by name and how many rounds; a settling practice, a wind-down before sleep, or a few breaths before something hard',
    notWhen:
      'do NOT use timer for breathing, and do NOT use breathing for silent sitting — a timer counts a held effort, breathing paces each breath. Name the pattern; never describe counts in the detail text',
    reads: ['breath_pattern', 'breath_cycles', 'detail'],
    example: { name: 'Settle before we start', tool: 'breathing', breath_pattern: 'box', breath_cycles: 6 },
  },
  meditate: {
    class: 'guided',
    summary:
      'silent sitting for a set time — a settling practice, or a quiet few minutes after effort. Set duration_min; bells mark the start and end (and optionally an interval) so they can close their eyes',
    notWhen:
      'do NOT use meditate for guided or narrated sitting, and do NOT use it for paced breathing — breathing paces each breath, meditate leaves them alone with a clock',
    reads: ['duration_min', 'meditate_bells', 'meditate_interval_min', 'detail'],
    example: { name: 'Sit quietly', tool: 'meditate', duration_min: 10, meditate_bells: 'start_end' },
  },
  grounding: {
    class: 'guided',
    summary:
      'a short tap-forward flow that gives a racing mind something ordinary to do — reach for this in the moment, not as a daily practice. Pick the game with grounding_game',
    notWhen:
      'do NOT use grounding as a settling practice (that is breathing) and do NOT use it to pass time (that is meditate). Nothing here is scored or checked',
    reads: ['grounding_game', 'grounding_bank', 'detail'],
    example: { name: 'Five senses', tool: 'grounding', grounding_game: 'senses' },
  },
  reps: {
    class: 'capture',
    summary: 'a counted sets × reps movement — the person logs the reps they actually did, set by set',
    reads: ['sets', 'reps', 'load'],
    example: { name: 'Goblet squat', tool: 'reps', sets: 3, reps: 10, load: '35 lb' },
  },
  photo: {
    class: 'capture',
    summary: 'they photograph something (their form, a plate, a progress shot)',
    reads: ['detail'],
    example: { name: 'Photo your plate', tool: 'photo', detail: 'Snap the meal before you eat' },
  },
  journal: {
    class: 'capture',
    summary: 'they write or speak a short reflection — put the question in detail',
    reads: ['detail'],
    example: { name: 'Name one win', tool: 'journal', detail: 'What went well today, however small?' },
  },
};

export interface SetFlowSpec {
  summary: string;
}

/** How a block's sets are sequenced — the second half of the coach's structural palette. */
export const SET_FLOWS: Record<BlockMode, SetFlowSpec> = {
  straight: {
    summary: "default — each exercise's sets done consecutively (A,A,B,B). Omit mode for ordinary strength work",
  },
  circuit: {
    summary:
      'rotate the block\'s items for "rounds" rounds (A,B,A,B), one rest per round. Use ONLY for items meant to be done together — a conditioning triplet, a mobility flow. Set "rounds"; each item\'s per-round target is its reps or duration_min',
  },
};

/** The per-item tool names the coach may emit — the api whitelist derives from this, no hand-kept copy. */
export const SESSION_TOOL_KINDS = Object.keys(COACH_TOOLS) as SessionItemTool[];

/** The block set-flow names the coach may emit — the api whitelist derives from this. */
export const BLOCK_MODE_KINDS = Object.keys(SET_FLOWS) as BlockMode[];

const CLASS_HEADER: Record<ToolClass, string> = {
  guided: 'GUIDED — do the thing; the log records only that it happened',
  capture: 'CAPTURE — the person emits data that becomes the log',
};

/**
 * Render the catalog to the hierarchical, LLM-facing block injected as `{{tool_catalog}}`. Grouped
 * by capture class, one bullet per tool with its when/trap/fields/example, then the SET FLOW section.
 * Deterministic (stable order) so the prompt is cacheable.
 */
export function renderCoachToolCatalog(): string {
  const lines: string[] = [
    'TOOL CATALOG — the ONLY ways the app can play a step. Set each item\'s "tool" to one of these names',
    '(or null to let the app infer from the quantities you filled). Pick the ONE tool that matches how the',
    'person physically does the step; a name not in this catalog will be dropped.',
  ];
  for (const cls of ['guided', 'capture'] as ToolClass[]) {
    lines.push('', `${CLASS_HEADER[cls]}:`);
    for (const kind of SESSION_TOOL_KINDS) {
      const t = COACH_TOOLS[kind];
      if (t.class !== cls) continue;
      lines.push(`  • ${kind} — ${t.summary}`);
      if (t.notWhen) lines.push(`      trap: ${t.notWhen}`);
      lines.push(`      fills: ${t.reads.join(', ')}`);
      lines.push(`      e.g. ${JSON.stringify(t.example)}`);
    }
  }
  lines.push('', 'SET FLOW — how each block\'s sets are sequenced. Set each block\'s "mode":');
  for (const mode of BLOCK_MODE_KINDS) lines.push(`  • ${mode} — ${SET_FLOWS[mode].summary}`);
  lines.push('', 'GROUNDING GAMES — the only values "grounding_game" accepts:');
  for (const g of GROUNDING_GAMES) lines.push(`  • ${g} — ${GROUNDING_NAMES[g]}`);
  lines.push('  "letters" also reads "grounding_bank": animals | foods | cities.');
  lines.push(
    '',
    `SITTING — "meditate" reads duration_min (1-${MAX_SIT_MINUTES} min, default ${DEFAULT_SIT_MINUTES}) and`,
    `"meditate_bells": ${MEDITATE_BELL_KINDS.join(' | ')}. Use "interval" only for longer sits, with`,
    '"meditate_interval_min" for the spacing. Anything else is replaced with start_end.',
  );
  lines.push(
    '',
    'BREATH PATTERNS — the only values "breath_pattern" accepts. Choose by what the moment needs;',
    'an unlisted name is replaced with coherent. Round counts are capped for safety, so ask for what',
    'you mean and the app will keep it safe.',
  );
  for (const p of BREATH_PATTERNS) {
    const counts = patternCounts(p);
    lines.push(`  • ${p.id} (${p.name}, ${counts}) — ${p.summary}`);
    if (p.caution) lines.push(`      caution: ${p.caution} Keep it brief and only before effort.`);
  }
  return lines.join('\n');
}

/**
 * Compile-time guard: every coach-emittable tool MUST have a client renderer (a `StepTool` kind in
 * walkthrough.ts). If you add a `SessionItemTool` without a matching `StepTool` variant, the type
 * below stops being `never`, `true` is no longer assignable, and this line fails to compile. No
 * runtime cost — it exists only to break the build before an un-renderable tool ships.
 */
const _everyCoachToolRenders: Exclude<SessionItemTool, StepToolKind> extends never ? true : false = true;
void _everyCoachToolRenders;
