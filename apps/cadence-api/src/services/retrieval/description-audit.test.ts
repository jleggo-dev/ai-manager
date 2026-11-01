import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { coachToolDefinitions } from '../coach-tools.ts';
import { RETRIEVAL_FUNCTIONS } from './registry.ts';
import { DRAWER_LABEL_MAX, FIND_TOOLS_NAME, META_TOOL_NAMES, labelBudgetReport } from '../coach-tool-tiers.ts';
import { COACH_ACTION_TOOLS } from '../coach-actions.ts';
import { COACH_META_TOOLS } from '../coach-meta-tools.ts';
import { EXTEND_HORIZON } from '../coach-action-extend-horizon.ts';
import { BUILD_WEEK_AHEAD } from '../coach-action-build-week-ahead.ts';
import { PAUSE_WEEK } from '../coach-action-pause-week.ts';
import { REVISE_SESSION } from '../coach-action-revise-session.ts';
import { START_REPLAN } from '../coach-action-start-replan.ts';
import { countPhrase, GATE_PHRASE, GATE_TOKEN, type Mutates } from '../tool-mutates.ts';

/**
 * The description audit, made mechanical (owner ruling 2026-08-14: "make sure we aren't using
 * internal jargon or shorthand an LLM might not understand").
 *
 * These strings are read cold by two models — the coach picking a tool mid-reply, and the Broker
 * choosing pack functions from `renderCatalogDoc` — and neither has access to our schema or our
 * heads. The tool-catalog audit (PLAN.md 2026-08-04) established the discipline for the session
 * widgets; this file holds the harness tools to the same rules, so a description that drifts back
 * into shorthand fails CI instead of quietly mis-teaching a model for weeks.
 */

/**
 * Words that mean something to THIS CODEBASE and nothing reliable to a model reading cold.
 * "occurrences" is a table name; a "window" could be UI chrome; "Params:" was a shorthand only
 * we understood; "OFF" (Open Food Facts) reads as the word "off". Each of these was live in a
 * description until 2026-08-14.
 */
const BANNED: Array<{ re: RegExp; why: string }> = [
  { re: /\boccurrences?\b/i, why: 'schema table name — say "sessions" or "what they planned"' },
  { re: /\bwindow\b/i, why: 'ambiguous — say "the last N days"' },
  { re: /Params:/, why: 'shorthand — show a literal example like {"days": 30} instead' },
  { re: /\bprovenance\b/i, why: 'internal concept' },
  { re: /\bcache(d)?\b/i, why: 'engineering detail a model cannot use' },
  { re: /\bdeterministic\b/i, why: 'engineering detail a model cannot use' },
  { re: /\bbaseline\b/i, why: 'internal column name — describe the fact instead' },
  { re: /\bcaptured?\b/i, why: 'internal goal status (and brand-banned in user copy)' },
  { re: /\bbroker\b/i, why: 'hidden internal entity' },
  { re: /\bdossier\b/i, why: 'internal name for the context pack' },
  { re: /\bjsonb?\b/i, why: 'storage detail' },
  { re: /\bOFF\b/, why: 'Open Food Facts abbreviation — reads as the word "off"' },
  { re: /shared DB/i, why: 'engineering detail' },
  { re: /\blocked\b/i, why: 'pre-rename status word — the canonical term is "committed"' },
];

/** Confusable pairs: at least ONE side must name the other, so a model choosing between them has
 *  the tiebreak in front of it (tool-catalog audit rule 2). */
/**
 * Confusable pairs — and this list is a BACKLOG, not a fixture. Every entry documents an ambiguity
 * we chose to explain instead of remove, so it should only ever shrink. It went from eight to two
 * on 2026-08-16 without a single description being reworded:
 *
 *  - Four dissolved on their own when the tiering made one side of each a dossier fact rather than
 *    a tool (health history, consistency, objectives). You cannot confuse two tools when only one
 *    of them is a tool.
 *  - Two more went when `get_nutrition` replaced four food reads with one door and a `view`
 *    parameter — the pairs they needed disambiguating no longer face each other.
 *
 * What remains is genuinely two different things each time, and the description says which.
 */
const TIEBREAK_PAIRS: Array<[string, string]> = [
  ['get_workout_history', 'get_recent_logs'], // device records vs their own words
  ['get_practice_totals', 'get_goal_progress'], // one counted thing vs overall numbers
  ['get_repertoire', 'get_practice_totals'], // what they know vs how much they practiced
  // Named commitment edits (seconds, instant card) vs the whole week reshaped (minutes, background
  // run). The 2026-08-31 incident IS this ambiguity mis-resolved — a five-exercise tweak routed
  // into a full re-synthesis — so the always-on side must carry the tiebreak (PLAN-CHANGES.md
  // Phase 2; the rebuild lives in the tail behind the `rebuild` facade since 2026-09-15,
  // invisible to this file's byName lookup).
  ['propose_plan_change', 'rebuild'],
];

/** Every failure here points at the checklist, because the rule broken is written down there and
 *  a bare array of names does not tell a newcomer what to do about it. */
const HOW = 'see docs/cadence/TOOL-HARNESS.md → "Adding a tool: the checklist"';

const defs = coachToolDefinitions();
const byName = new Map(defs.map((d) => [d.function.name, d.function]));

describe('harness tool descriptions', () => {
  it('every retrieval function description is free of internal jargon (the Broker reads them all)', () => {
    const hits: string[] = [];
    const all = [
      ...Object.values(RETRIEVAL_FUNCTIONS).map((f) => ({ name: f.name, description: f.description })),
      ...defs.map((d) => ({ name: d.function.name, description: d.function.description })),
    ];
    for (const f of all) {
      for (const b of BANNED) {
        if (b.re.test(f.description)) hits.push(`${f.name}: ${b.re} (${b.why})`);
      }
    }
    expect(hits, HOW).toEqual([]);
  });

  it('every coach-exposed tool says WHEN to use it', () => {
    const missing = defs.filter((d) => !/\bUse\b/.test(d.function.description)).map((d) => d.function.name);
    expect(missing, HOW).toEqual([]);
  });

  it('every declared parameter is taught in the description too (the Broker never sees the JSON schema)', () => {
    const missing: string[] = [];
    for (const d of defs) {
      const props = (d.function.parameters as { properties?: Record<string, unknown> }).properties ?? {};
      for (const key of Object.keys(props)) {
        // The convention is a literal worked example: ... {"days": 30} ...
        if (!d.function.description.includes(`"${key}"`)) missing.push(`${d.function.name}.${key}`);
      }
    }
    expect(missing, HOW).toEqual([]);
  });

  it('parameter descriptions are jargon-free and say their default', () => {
    const bad: string[] = [];
    for (const d of defs) {
      const props =
        (d.function.parameters as { properties?: Record<string, Record<string, unknown>> }).properties ?? {};
      for (const [key, spec] of Object.entries(props)) {
        const desc = String(spec.description ?? '');
        for (const b of BANNED) if (b.re.test(desc)) bad.push(`${d.function.name}.${key}: ${b.why}`);
        const required = (d.function.parameters as { required?: string[] }).required ?? [];
        // A param the caller may leave out must say what happens if they do. Three honest
        // shapes: a stated default, the omission behavior in words ("omit to get their saved
        // recipes"), or — the case action tools introduced — CONDITIONALLY required, where the
        // answer is "it depends which action you chose" ("Required for retarget").
        if (!required.includes(key) && !/default|omit|required for|unless/i.test(desc))
          bad.push(`${d.function.name}.${key}: does not say what happens without it`);
      }
    }
    expect(bad, HOW).toEqual([]);
  });

  it('every confusable pair carries its tiebreak on at least one side', () => {
    const uncovered: string[] = [];
    for (const [a, b] of TIEBREAK_PAIRS) {
      const da = byName.get(a)?.description ?? RETRIEVAL_FUNCTIONS[a]?.description ?? '';
      const db = byName.get(b)?.description ?? RETRIEVAL_FUNCTIONS[b]?.description ?? '';
      if (!da.includes(b) && !db.includes(a)) uncovered.push(`${a} ↔ ${b}`);
    }
    expect(uncovered, HOW).toEqual([]);
  });

  it('descriptions stay compact enough to be read, not skimmed', () => {
    const tooLong = Object.values(RETRIEVAL_FUNCTIONS)
      .filter((f) => f.description.length > 520)
      .map((f) => `${f.name} (${f.description.length})`);
    expect(tooLong, HOW).toEqual([]);
  });

  /** The two meta tools are neither reads nor actions: find_tools' description IS the drawer's
   *  generated index (owner ruling 2026-08-30 — coach-tool-tiers.ts DRAWER_INDEX), so it gets its
   *  own, larger bound here instead of the action bound; growth control lives in
   *  coach-drawer-index.test.ts (per-hook cap + label cap). use_tool stays action-sized. */
  it('meta tools stay bounded — the index generously, use_tool tightly', () => {
    const metas = defs.filter((d) => META_TOOL_NAMES.includes(d.function.name as (typeof META_TOOL_NAMES)[number]));
    expect(metas.length).toBe(2);
    for (const m of metas) {
      const isIndex = m.function.name === FIND_TOOLS_NAME;
      const cap = isIndex ? DRAWER_LABEL_MAX : 800;
      const why = isIndex ? labelBudgetReport(m.function.description) : `${m.function.name} over its ${cap}-char bound`;
      expect(m.function.description.length, why).toBeLessThanOrEqual(cap);
    }
  });

  /** Action tools get more room than a read — each carries a safety gate ("only when they have
   *  plainly decided") and says what calling it does to the user's data — but not unlimited. The
   *  gate itself is checked below, from each tool's `mutates` field, for every action. */
  it('action tools are bounded too', () => {
    const actions = defs.filter(
      (d) =>
        !RETRIEVAL_FUNCTIONS[d.function.name] &&
        !META_TOOL_NAMES.includes(d.function.name as (typeof META_TOOL_NAMES)[number]),
    );
    expect(actions.length).toBeGreaterThan(0);
    const tooLong = actions
      .filter((d) => d.function.description.length > 800)
      .map((d) => `${d.function.name} (${d.function.description.length})`);
    expect(tooLong, HOW).toEqual([]);
  });
});

/**
 * What a tool does to their data is a FIELD, and the sentence that says so is generated from it
 * (HARNESS-V3 C4, TOOL-HARNESS.md backlog #3 — tool-mutates.ts).
 *
 * This replaces a regex over the always-on descriptions for "takes effect immediately" or "does NOT
 * change anything". That check could not see a tail action at all, and could not tell a tool that
 * waits for a tap from one that commits on call: either phrase passed for either. Whether it commits
 * or waits is the single most important thing a model can know about an action, so it is now
 * checked for every tool from the field itself.
 */
describe('every tool declares what it changes (mutates), and actions say it exactly once', () => {
  const MODES: readonly Mutates[] = ['none', 'proposes', 'immediate'];
  // Reached only through the plan facades, but built the same way and gated the same way.
  const FACADE_INNER = [EXTEND_HORIZON, BUILD_WEEK_AHEAD, PAUSE_WEEK, REVISE_SESSION, START_REPLAN];
  const actions = [...Object.values(COACH_ACTION_TOOLS), ...FACADE_INNER];

  it('every read, action and meta tool declares a mode', () => {
    const tools = [...Object.values(RETRIEVAL_FUNCTIONS), ...actions, ...Object.values(COACH_META_TOOLS)];
    const missing = tools.filter((t) => !MODES.includes(t.mutates)).map((t) => t.name);
    expect(missing, HOW).toEqual([]);
  });

  it('every retrieval function is a read, and none claims to take effect', () => {
    const bad = Object.values(RETRIEVAL_FUNCTIONS)
      .filter((f) => f.mutates !== 'none' || countPhrase(f.description, GATE_PHRASE.immediate) > 0)
      .map((f) => f.name);
    expect(bad, HOW).toEqual([]);
  });

  /** An action that changes nothing is a read, and belongs in the retrieval registry instead. */
  it('every action changes something — proposes or immediate', () => {
    expect(
      actions.filter((a) => a.mutates === 'none').map((a) => a.name),
      HOW,
    ).toEqual([]);
  });

  it("every action's description carries its own mode's sentence exactly once, and never the other", () => {
    const bad: string[] = [];
    for (const a of actions) {
      if (a.mutates === 'none') continue;
      const own = countPhrase(a.description, GATE_PHRASE[a.mutates]);
      const other = countPhrase(a.description, GATE_PHRASE[a.mutates === 'immediate' ? 'proposes' : 'immediate']);
      if (own !== 1) bad.push(`${a.name}: "${GATE_PHRASE[a.mutates]}" appears ${own} times (want 1)`);
      if (other) bad.push(`${a.name} is ${a.mutates} but its description says the other mode's sentence`);
      if (a.description.includes(GATE_TOKEN)) bad.push(`${a.name}: an unreplaced ${GATE_TOKEN} reached the model`);
    }
    expect(bad, HOW).toEqual([]);
  });

  /**
   * The sentence comes from the generator, never typed by hand: a hand-typed one is the drift the
   * field exists to stop. Read the action sources and fail on the phrase anywhere outside a comment.
   */
  it('no action source types the sentence by hand — `{gate}` and `defineAction` supply it', () => {
    const dir = new URL('../', import.meta.url);
    const files = readdirSync(dir).filter(
      (f) => (/^coach-action-.+\.ts$/.test(f) || f === 'coach-actions.ts') && !f.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(10);
    const typed: string[] = [];
    for (const f of files) {
      readFileSync(new URL(f, dir), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (/takes? effect immediately|does NOT change anything/i.test(line)) typed.push(`${f}:${i + 1}`);
        });
    }
    expect(typed, HOW).toEqual([]);
  });

  /**
   * The two meta tools describe OTHER tools' gates, not their own: `find_tools` only searches
   * ('none'), and `use_tool` runs whatever she names, so it declares the most it can do
   * ('immediate') and sends her to the named tool's own sentence instead of carrying one.
   */
  it('the meta tools: find_tools only reads, use_tool defers to the tool it runs', () => {
    const find = COACH_META_TOOLS[FIND_TOOLS_NAME]!;
    const use = COACH_META_TOOLS.use_tool!;
    expect(find.mutates).toBe('none');
    expect(countPhrase(find.description, GATE_PHRASE.immediate)).toBe(0);
    expect(use.mutates).toBe('immediate');
    expect(use.description).toMatch(/each says so in its own description/);
  });
});
