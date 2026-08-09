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

import type { BlockMode, SessionItem, SessionItemTool } from './types/occurrence.ts';
import type { StepToolKind } from './walkthrough.ts';
import { BREATH_PATTERNS, patternCounts } from './breathing.ts';
import {
  INTERVAL_TEMPLATES,
  MAX_INTERVAL_SEC,
  MAX_ROUNDS,
  MAX_WORK_SEC,
  MIN_WORK_SEC,
  intervalShorthand,
} from './interval.ts';
import { DEFAULT_SIT_MINUTES, MAX_SIT_MINUTES, MEDITATE_BELL_KINDS } from './meditate.ts';
import { GROUNDING_GAMES, GROUNDING_NAMES } from './grounding.ts';
import { JOURNAL_BANKS, bankFamily, type JournalFamily } from './journal.ts';

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
  | 'grounding_bank'
  | 'journal_bank'
  | 'interval_work_sec'
  | 'interval_recover_sec'
  | 'interval_rounds'
  | 'interval_warmup_sec'
  | 'interval_cooldown_sec';

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
    summary:
      'a cue to read and follow, capturing nothing — the connective tissue INSIDE a session (settle in, set up, transition) and THE DEFAULT when nothing interactive fits',
    reads: ['detail'],
    example: { name: 'Settle in', tool: 'read', detail: 'Find a comfortable seat, shoulders soft' },
  },
  timer: {
    class: 'guided',
    // "a 5-min meditation" USED to be an example here — teaching the exact collision this line
    // now warns against: it taught timer-for-meditate, and by analogy timer-for-any-short-mind-
    // practice, which is how a 5-min noticing practice kept getting a bare clock (probe, 2 of 3
    // runs 2026-08-04) instead of the grounding flow that IS the practice.
    summary:
      'the passage of time itself IS the task — a held or timed physical effort you watch a clock for (a 1-min plank, a 20-min zone-2 run, a wall sit)',
    notWhen:
      'do NOT pick timer just because a step has a duration — "a minute to settle in" has a duration but is read. A timer is ONE continuous stretch: work that alternates with rest and repeats (sprints, HIIT, EMOM, Tabata) is interval, and a bare timer there makes the person do the counting the app was built to do. And a MIND practice with a duration is almost never a timer: silent sitting is meditate, and a noticing or attention practice ("notice five things", a noticing walk, being more present) is grounding — there the noticing is the task and the clock is furniture',
    reads: ['duration_min'],
    example: { name: 'Forearm plank', tool: 'timer', duration_min: 1 },
  },
  interval: {
    class: 'guided',
    summary:
      'work and recover, alternating, on a clock that runs the whole thing hands-free — sprints, a HIIT finisher, EMOM, Tabata, hill repeats, a rowing pyramid. One press of start and the app hands over between phases with a chime and a colour change, so nobody has to look at the phone mid-effort. Set interval_work_sec and interval_rounds; add interval_recover_sec for a breather (leave it out for EMOM, where the rest is whatever is left of the minute)',
    notWhen:
      'ONE effort with no repeat is a timer, not an interval — an interval is the alternation. Different MOVEMENTS each round (burpees, then squats, then a plank) is a circuit block, not this: interval rounds are the same work repeated. Do not also send duration_min — the length is the arithmetic of the numbers you set, and a second figure just contradicts the ring. Warm-up and cool-down are optional and sit OUTSIDE the rounds; leave them out when the session already has its own warm-up block',
    reads: [
      'interval_work_sec',
      'interval_recover_sec',
      'interval_rounds',
      'interval_warmup_sec',
      'interval_cooldown_sec',
      'detail',
    ],
    example: {
      name: 'Bike sprints',
      tool: 'interval',
      interval_work_sec: 40,
      interval_recover_sec: 20,
      interval_rounds: 6,
    },
  },
  checkoff: {
    class: 'guided',
    summary: 'do-it-and-confirm with nothing to capture — a distance target, "step outside", a mobility drill',
    notWhen:
      'if they WATCH a clock while doing it, that is timer; checkoff is for things you simply confirm happened (a distance, an errand, a drill). And it is a real step of its own — a cue inside another step is read',
    reads: ['distance_km', 'detail'],
    example: { name: 'Easy shakeout jog', tool: 'checkoff', distance_km: 3 },
  },
  breathing: {
    class: 'guided',
    summary:
      'paced breathing — the app runs the rhythm and they follow it. Pick a pattern by name and how many rounds; a daily practice, a wind-down before sleep, a few breaths before something hard, or one step of a longer session',
    notWhen:
      'a timer counts a held effort; breathing paces each breath — pick whichever matches what they are actually doing. Name the pattern rather than describing counts in the detail text, and never promise a feeling will change',
    reads: ['breath_pattern', 'breath_cycles', 'detail'],
    example: { name: 'Settle before we start', tool: 'breathing', breath_pattern: 'box', breath_cycles: 6 },
  },
  meditate: {
    class: 'guided',
    summary:
      'silent sitting for a set time — a daily practice, a quiet few minutes after effort, or a step inside a longer session. Set duration_min; bells mark the start and end (and optionally an interval) so they can close their eyes',
    notWhen:
      'meditate leaves someone alone with a clock — if you want each breath paced, that is breathing; if you want words in their ear, that is not built yet',
    reads: ['duration_min', 'meditate_bells', 'meditate_interval_min', 'detail'],
    example: { name: 'Sit quietly', tool: 'meditate', duration_min: 10, meditate_bells: 'start_end' },
  },
  grounding: {
    class: 'guided',
    summary:
      'a short tap-forward flow that gives busy attention something ordinary to do. Good in the moment, and equally good as a daily noticing practice or a step inside a longer session — senses and object are attention practices in their own right, while letters and countback are more purely distraction. Pick the game with grounding_game',
    notWhen:
      'nothing here is ever scored or checked — never frame it as a test, and never promise it will make a feeling go away',
    reads: ['grounding_game', 'grounding_bank', 'detail'],
    example: { name: 'Five senses', tool: 'grounding', grounding_game: 'senses' },
  },
  feeling_log: {
    class: 'capture',
    summary:
      "a 20-second check-in: ONE word for how they're doing and how much room it's taking, with an optional line. The mind side's weigh-in — use it while you're still learning someone's patterns, or when checking in would help",
    notWhen:
      'a word and a size, never sentences — writing that deserves rereading is journal, not this. Do NOT schedule it every day forever: ask while you are learning their patterns, then stop. And never follow one capture step straight with another — two questions back to back is one too many',
    reads: ['detail'],
    example: { name: 'How are you doing?', tool: 'feeling_log' },
  },
  reps: {
    class: 'capture',
    summary: 'a counted sets × reps movement — the person logs the reps they actually did, set by set',
    reads: ['sets', 'reps', 'load'],
    example: { name: 'Goblet squat', tool: 'reps', sets: 3, reps: 10, load: '35 lb' },
  },
  photo: {
    class: 'capture',
    summary:
      "they photograph something — their form on a lift, a progress shot, a plate. For meals, prefer the day's own meal-log tasks; a photo step here is for when THIS session is the thing being photographed",
    reads: ['detail'],
    example: { name: 'Check your setup', tool: 'photo', detail: 'Snap your squat setup from the side' },
  },
  journal: {
    class: 'capture',
    summary:
      "real WRITING, kept where they can reread it — the tool for any writing practice, not only reflection: free-writing a scene, morning pages, a studio log, a language learner's paragraph, lectio divina, working a problem out on the page. Name a question bank with journal_bank (the app supplies a fresh phrasing) or write your own prompt in detail — your sentence always wins, and for craft work it usually should. Add duration_min for a TIMED free-write (a quiet clock; writing continuously IS the practice)",
    notWhen:
      'sentences, never a yes/no, a number, or a single mood word — one word about how they are doing is feeling_log. Never promise to analyse what they write. The banks are a floor, not a menu: match the bank FAMILY to the practice (a novelist gets craft, never gratitude), and when you can write a prompt better fitted to this person and this week, write it',
    reads: ['journal_bank', 'detail', 'duration_min'],
    example: { name: 'Three good things', tool: 'journal', journal_bank: 'three_good_things' },
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
 * The same catalog, one line per tool — for the CHAT coach, which needs to *talk about* what a
 * session can contain, not emit one. Someone asking "could we put some breathwork in?" or "do you
 * do journaling prompts?" is asking about this list, and a chat coach that has never seen it either
 * invents a tool the app cannot play or says no to something that exists. Deliberately drops the
 * fields/examples/traps (that is authoring detail the chat coach has no use for) so the block stays
 * a few hundred tokens in every session.
 */
export function renderToolCatalogBrief(): string {
  const lines: string[] = [
    '== WAYS A STEP CAN BE PLAYED (the app can guide these; anything else is just words on a page) ==',
  ];
  for (const kind of SESSION_TOOL_KINDS) {
    // First clause only — the summaries carry authoring nuance after the dash that a chat coach
    // does not need and should not read aloud.
    lines.push(`  • ${kind} — ${(COACH_TOOLS[kind].summary.split(/[—;]/)[0] ?? '').trim()}`);
  }
  lines.push(
    `  breathing patterns: ${BREATH_PATTERNS.map((p) => p.id).join(', ')}.`,
    `  interval shapes: ${INTERVAL_TEMPLATES.map((t) => `${t.label} (${t.workSec}/${t.recoverSec} × ${t.rounds})`).join(
      ', ',
    )} — or any numbers you like.`,
    `  grounding games: ${GROUNDING_GAMES.join(', ')}.`,
    `  journal prompt banks by family: ${(['reflection', 'craft', 'study', 'devotion'] as JournalFamily[])
      .map((f) => `${f} (${JOURNAL_BANKS.filter((b) => bankFamily(b) === f).length})`)
      .join(', ')}.`,
    'These names are internal. Say them in plain words ("some paced breathing", "a short sit") and',
    'never speak the identifier itself — "I\'ll add a feeling_log" is not something a coach says. If',
    'they ask for something not on this list, say so plainly and ask what they were after; do not',
    'promise a step the app cannot actually play.',
  );
  return lines.join('\n');
}

/**
 * Render the catalog to the hierarchical, LLM-facing block injected as `{{tool_catalog}}`. Grouped
 * by capture class, one bullet per tool with its when/trap/fields/example, then the SET FLOW section.
 * Deterministic (stable order) so the prompt is cacheable.
 */
export function renderCoachToolCatalog(): string {
  const lines: string[] = [
    'TOOL CATALOG — the ONLY ways the app can play a step. Set each item\'s "tool" to one of these names',
    '(or null to let the app infer from the fields you filled). Pick the ONE tool that matches how the',
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
  lines.push(
    '',
    'JOURNAL BANKS — the only values "journal_bank" accepts, grouped by the practice they serve.',
    'Pick from the family that matches what this person actually does; a prompt you write yourself',
    'in "detail" beats any of them when you know enough to fit it to them.',
  );
  for (const fam of ['reflection', 'craft', 'study', 'devotion'] as JournalFamily[]) {
    const inFamily = JOURNAL_BANKS.filter((b) => bankFamily(b) === fam);
    if (inFamily.length === 0) continue;
    lines.push(`  ${fam}:`);
    for (const b of inFamily) lines.push(`    • ${b.id} — ${b.label}`);
  }
  lines.push(
    '',
    'INTERVALS — "interval" is five numbers, all seconds except the round count. There is no shape',
    'to name and no mode to pick: the familiar ones are just numbers, and anything between them is',
    'equally legal. Say what this person should actually do.',
  );
  for (const t of INTERVAL_TEMPLATES) {
    const shape = intervalShorthand({
      warmupSec: 0,
      workSec: t.workSec,
      recoverSec: t.recoverSec,
      rounds: t.rounds,
      cooldownSec: 0,
    });
    lines.push(`  • ${t.label} = ${shape} — ${t.summary}`);
  }
  lines.push(
    `  bounds: work ${MIN_WORK_SEC}-${MAX_WORK_SEC}s, recover 0-${MAX_WORK_SEC}s (0 = EMOM), rounds 1-${MAX_ROUNDS},`,
    `  warm-up/cool-down 0-900s each. The whole run is capped at ${Math.round(MAX_INTERVAL_SEC / 60)} min — ask for`,
    '  what you mean and the app trims rounds to fit rather than refusing.',
  );
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

/**
 * Compile-time guard #2: every field the catalog TELLS the coach to fill must actually exist on
 * `SessionItem`. `reads` is prose to the model — it will happily emit a field this file invented,
 * the normalizer will drop it, and the step will render without the parameter that was the whole
 * point. Naming a field here that the type doesn't have now fails the build instead.
 *
 * This is the SessionItem-params question, settled by construction (REQ9 §7): flat typed fields
 * per tool, not one `params` jsonb. The reason is not ergonomics but reliability — models fill
 * sibling fields far more consistently than nested objects, which is why the now-menu flattens its
 * output too. The cost is a widening interface; the tripwire for revisiting is when a tool needs
 * fields no other tool shares AND the count makes the type hard to read.
 */
const _everyItemFieldExists: Exclude<ItemField, keyof SessionItem> extends never ? true : false = true;
void _everyItemFieldExists;
