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
 *
 * ── HOW TO WRITE THE STRINGS IN THIS FILE (owner ruling 2026-08-30) ─────────────────────────────
 *
 * Every `summary`, `notWhen` and rendered line below is read by a MODEL, not by a person. Cadence's
 * house voice — the warm, image-led register of BRAND.md and PLAN.md — is a defect here: it makes
 * the model infer a rule instead of reading one. The rules:
 *
 *   1. **Name categories; do not illustrate them.** "a click on a plank, a run or a sit is an
 *      intrusion" made the model work out which step kinds that image covered. "work that alternates
 *      with rest and repeats (sprints, HIIT, EMOM, Tabata) is interval" does not.
 *   2. **State rules, not frequencies or sentiments.** "omitting it is the right answer almost
 *      every time" is a statistic about past sessions; "omit it and the step has no metronome" is
 *      an instruction.
 *   3. **No metaphor for mechanism.** "the clock is furniture", "the connective tissue of a
 *      session", "rides alongside" — say what the field or tool literally does instead.
 *   4. **Cut description that cannot change a choice.** The coach picks a tool; how the player
 *      feels to use ("one press of start and nobody looks at their phone") never enters that
 *      decision and costs tokens in every prescribe-session call.
 *   5. **Keep concrete examples and the exact traps.** Plain is not the same as vague. The
 *      specific collisions ("a minute to settle in" has a duration but is `read`) are the most
 *      valuable text in this file — they were each written after a real misfire.
 *   6. **Size check:** compare a new entry against INTERVALS (~760 chars for a whole tool with
 *      five fields). The metronome once shipped at 1,170 chars for two numbers.
 *
 * Load-bearing format constraint: `renderToolCatalogBrief()` takes each `summary` UP TO its first
 * em-dash or semicolon as the chat coach's one-liner. So every summary must open with a short,
 * self-contained clause, then a dash, then the authoring detail. Moving that dash changes what the
 * chat coach says out loud.
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
  setShorthand,
} from './interval.ts';
import {
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_SIT_MINUTES,
  MAX_SIT_MINUTES,
  MEDITATE_BELL_KINDS,
  MIN_INTERVAL_MINUTES,
} from './meditate.ts';
import { DEFAULT_METER, MAX_BPM, MAX_METER, MIN_BPM, MIN_METER } from './metronome.ts';
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
  | 'interval_cooldown_sec'
  | 'metronome_bpm'
  | 'metronome_meter'
  | 'per_side';

/** Capture class (mirrors `stepCaptureMode`): `guided` = do it, log records only that it happened;
 *  `capture` = the person emits data that BECOMES the log. */
export type ToolClass = 'guided' | 'capture';

export interface CoachToolSpec {
  class: ToolClass;
  /**
   * What the tool is and when to pick it — the coach reads this to choose. MUST open with a short
   * self-contained clause followed by an em-dash: `renderToolCatalogBrief` cuts there for the chat
   * coach's one-liner. Plain and literal after the dash too — see the style rules at the top.
   */
  summary: string;
  /**
   * The judgment the field list cannot carry: which OTHER tool a near-miss actually belongs to
   * (e.g. duration ≠ timer). Name the competing tool explicitly — this text exists to resolve
   * collisions, so "that is grounding" beats any description of how the step feels.
   */
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
      'a cue to read and follow, capturing nothing — use it for steps that set up or move between other steps (settle in, set up the bar, move to the mat), and as THE DEFAULT when no other tool fits',
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
      'one physical effort held or sustained for a set time — a 1-min plank, a 20-min zone-2 run, a wall sit. A timer of 10 min or more keeps running past its target until they stop it (a ruck can run long) and logs the time they actually spent. Set per_side: true when the hold is done one side then the other (a calf stretch, a single-leg balance) — the app chimes and says "switch sides" at the halfway point, so give duration_min as the TOTAL for both sides',
    notWhen:
      'do NOT pick timer just because a step has a duration: "a minute to settle in" has a duration but is read. A timer is ONE continuous stretch — work that alternates with rest and repeats (sprints, HIIT, EMOM, Tabata) is interval. A duration alone does not pick the tool: meditate runs silence with bells, grounding runs a noticing game, and timer runs a plain clock',
    reads: ['duration_min', 'per_side'],
    example: { name: 'Forearm plank', tool: 'timer', duration_min: 1 },
  },
  interval: {
    class: 'guided',
    summary:
      'work and rest alternating for a number of rounds, run hands-free by the app — sprints, a HIIT finisher, EMOM, Tabata, hill repeats, a rowing pyramid. Set interval_work_sec and interval_rounds; add interval_recover_sec for rest between rounds (omit it for EMOM, where the rest is the remainder of the minute)',
    notWhen:
      'ONE effort with no repeat is a timer, not an interval. Different MOVEMENTS each round (burpees, then squats, then a plank) is a circuit block — interval rounds repeat the SAME work. Do NOT also send duration_min: the length is computed from the numbers you set, and a second figure contradicts it. Warm-up and cool-down are optional and sit OUTSIDE the rounds',
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
    summary:
      'do-it-and-confirm with nothing to capture — a distance target, "step outside", a mobility drill. Also the check on a BODY part: name it ("Knee check-in") and put the question in detail, and they answer in a few free words',
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
      'meditate gives silence and bells only — if each breath should be paced, that is breathing; spoken guided audio is not built yet, so do not describe one',
    reads: ['duration_min', 'meditate_bells', 'meditate_interval_min', 'detail'],
    example: { name: 'Sit quietly', tool: 'meditate', duration_min: 10, meditate_bells: 'start_end' },
  },
  grounding: {
    class: 'guided',
    summary:
      'a short tap-forward attention exercise — use it in the moment, as a daily noticing practice, or as a step inside a longer session. senses and object are attention practices; letters and countback are distraction. Pick the game with grounding_game',
    notWhen:
      'nothing here is ever scored or checked — never frame it as a test, and never promise it will make a feeling go away',
    reads: ['grounding_game', 'grounding_bank', 'detail'],
    example: { name: 'Five senses', tool: 'grounding', grounding_game: 'senses' },
  },
  feeling_log: {
    class: 'capture',
    summary:
      "a 20-second check-in — ONE word for how they're doing and how much room it's taking, plus an optional line",
    notWhen:
      'a word and a size, never sentences — writing meant to be reread is journal. It is about their HEAD (settled, wired, heavy, foggy) and only that: a check on a knee, a back, an ankle is checkoff with the question in detail, never feeling_log',
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
      "they photograph something — their form on a lift, a progress shot, a plate. A photo sent through the day's meal tasks is read into foods and priced for macros; a photo step here is stored with the session and not read",
    reads: ['detail'],
    example: { name: 'Check your setup', tool: 'photo', detail: 'Snap your squat setup from the side' },
  },
  journal: {
    class: 'capture',
    summary:
      "real WRITING, kept where they can reread it — use it for any writing practice, not only reflection: free-writing a scene, a first-thing morning brain-dump, a studio log, a language learner's paragraph, lectio divina, working a problem out on the page. Name a question bank with journal_bank (the app supplies a fresh phrasing) or write your own prompt in detail — when you set both, the detail prompt is the one they see. Add duration_min for a TIMED free-write",
    notWhen:
      'sentences, never a yes/no, a number, or a single mood word — one word about how they are doing is feeling_log. Never promise to analyse what they write. The banks are grouped by family — reflection, craft, study, devotion — and any bank is valid on any journal item; write your own prompt whenever you can fit it better to this person and this week',
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
    summary: 'the default when "mode" is omitted — each exercise\'s sets done in a row (A,A,B,B)',
  },
  circuit: {
    summary:
      'rotate the block\'s items for "rounds" rounds (A,B,A,B), one rest per round. Set "rounds"; each item\'s per-round target is its reps or duration_min. Available for any kind of work',
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
    'Grouped by family. A prompt you write in "detail" replaces the bank\'s question when both are set.',
  );
  for (const fam of ['reflection', 'craft', 'study', 'devotion'] as JournalFamily[]) {
    const inFamily = JOURNAL_BANKS.filter((b) => bankFamily(b) === fam);
    if (inFamily.length === 0) continue;
    lines.push(`  ${fam}:`);
    for (const b of inFamily) lines.push(`    • ${b.id} — ${b.label}`);
  }
  lines.push(
    '',
    'INTERVALS — "interval" is five numbers, all seconds except the round count. The named shapes',
    'below are only common combinations; any values within the bounds are equally valid. Set the',
    'numbers this person should actually do.',
  );
  for (const t of INTERVAL_TEMPLATES) lines.push(`  • ${t.label} = ${setShorthand(t)} — ${t.summary}`);
  lines.push(
    `  bounds: work ${MIN_WORK_SEC}-${MAX_WORK_SEC}s, recover 0-${MAX_WORK_SEC}s (0 = EMOM), rounds 1-${MAX_ROUNDS},`,
    `  warm-up/cool-down 0-900s each. The whole run is capped at ${Math.round(MAX_INTERVAL_SEC / 60)} min; over that,`,
    '  the app trims rounds to fit rather than refusing, so set the numbers you mean.',
  );
  lines.push(
    '',
    'METRONOME — an option on a step, not a tool. It adds a click track; the step keeps its own tool.',
    `  "metronome_bpm" (${MIN_BPM}-${MAX_BPM}) turns it on. Omit it and the step has no metronome.`,
    `  "metronome_meter" is beats per bar, ${MIN_METER}-${MAX_METER} (default ${DEFAULT_METER}). Omit if unknown.`,
    '  It works on any step, whatever its tool — an instrument drill, a run or row cadence, a lifting tempo.',
    '  Where someone has settled on a tempo for a piece, get_repertoire has it on that item.',
    '  e.g. {"name": "Hanon no. 1", "tool": "timer", "duration_min": 10, "metronome_bpm": 72}',
  );
  lines.push('', 'GROUNDING GAMES — the only values "grounding_game" accepts:');
  for (const g of GROUNDING_GAMES) lines.push(`  • ${g} — ${GROUNDING_NAMES[g]}`);
  lines.push('  "letters" also reads "grounding_bank": animals | foods | cities.');
  lines.push(
    '',
    `SITTING — "meditate" reads duration_min (1-${MAX_SIT_MINUTES} min, default ${DEFAULT_SIT_MINUTES}) and`,
    `"meditate_bells": ${MEDITATE_BELL_KINDS.join(' | ')}. Use "interval" to add a bell every`,
    `"meditate_interval_min" minutes between the start and end bells (${MIN_INTERVAL_MINUTES} minute or more,`,
    `never longer than the sit; ${DEFAULT_INTERVAL_MINUTES} when omitted). Anything else is replaced with start_end.`,
  );
  lines.push(
    '',
    'BREATH PATTERNS — the only values "breath_pattern" accepts. An unlisted name is replaced with',
    'coherent. Round counts are capped for safety; a higher count is clamped rather than refused, so',
    'set the number you mean.',
  );
  for (const p of BREATH_PATTERNS) {
    const counts = patternCounts(p);
    lines.push(`  • ${p.id} (${p.name}, ${counts}) — ${p.summary}`);
    if (p.caution) lines.push(`      caution: ${p.caution}`);
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
