import { describe, expect, it } from 'vitest';
import { coachToolDefinitions } from '../coach-tools.ts';
import { RETRIEVAL_FUNCTIONS } from './registry.ts';
import { FIND_TOOLS_NAME, META_TOOL_NAMES } from '../coach-tool-tiers.ts';

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
  // Phase 2; start_replan lives in the tail, invisible to this file's byName lookup).
  ['propose_plan_change', 'start_replan'],
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
      const cap = m.function.name === FIND_TOOLS_NAME ? 2600 : 800;
      expect(m.function.description.length, `${m.function.name} over its ${cap}-char bound`).toBeLessThanOrEqual(cap);
      expect(
        /take effect immediately|does NOT change anything|Takes effect immediately/i.test(m.function.description),
        `${m.function.name} must state its commit-or-waits gate`,
      ).toBe(true);
    }
  });

  /** Action tools get more room than a read — each carries a safety gate ("only when they have
   *  plainly decided") and says what calling it does to the user's data — but not unlimited. */
  it('action tools are bounded too, and every one states its safety gate', () => {
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
    // Whether it commits on call or waits for a tap is the single most important thing a model
    // can know about an action tool, so saying it is not optional.
    const silent = actions
      .filter(
        (d) =>
          !/take effect immediately|does NOT change anything|Takes effect immediately/i.test(d.function.description),
      )
      .map((d) => d.function.name);
    expect(silent, HOW).toEqual([]);
  });
});
