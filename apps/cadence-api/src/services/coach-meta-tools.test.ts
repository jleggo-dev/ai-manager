import { describe, it, expect, vi } from 'vitest';

/** Failures cite the checklist — the rule is written down and a bare name list does not say so. */
const HOW = 'see docs/cadence/TOOL-HARNESS.md → "Adding a tool: the checklist"';
import { searchTools, COACH_META_TOOLS } from './coach-meta-tools.ts';
import {
  alwaysOnToolNames,
  onDemandToolNames,
  DOSSIER_FUNCTIONS,
  ALWAYS_ACTIONS,
  TOOL_CATEGORIES,
} from './coach-tool-tiers.ts';
import { coachToolDefinitions, coachToolNames } from './coach-tools.ts';
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { coachActionNames } from './coach-actions.ts';

/**
 * The tiering. 24 tools rode every turn at ~5,000 tokens, growing linearly with a toolset the
 * owner intends to expand — and eight of them explained how to fetch facts the context pack had
 * already injected as text. These tests hold the shape that fixes it.
 *
 * The property that matters most is the last one: adding a READ must cost nothing per turn. That
 * is the answer to "what happens at 100 tools", and it is the thing a careless future change
 * would silently undo.
 */

describe('what she carries', () => {
  /** The two she needs most days. The rest are one round-trip away, weekly at most. */
  it('offers the daily actions on every turn, and only those', () => {
    const offered = new Set(coachToolDefinitions().map((d) => d.function.name));
    for (const a of ALWAYS_ACTIONS) expect(offered.has(a)).toBe(true);
    for (const a of coachActionNames()) {
      if (!(ALWAYS_ACTIONS as readonly string[]).includes(a)) expect(offered.has(a)).toBe(false);
    }
  });

  it('offers both meta tools, because finding one is useless without running it', () => {
    const offered = new Set(coachToolDefinitions().map((d) => d.function.name));
    expect(offered.has('find_tools')).toBe(true);
    expect(offered.has('use_tool')).toBe(true);
  });

  /** The pack already injects these as text; a tool for them is a second path to a fact she holds. */
  it('does not offer a dossier fact as a tool', () => {
    const offered = new Set(coachToolDefinitions().map((d) => d.function.name));
    for (const d of DOSSIER_FUNCTIONS) expect(offered.has(d)).toBe(false);
  });

  /** The exception, and the reason for it: she changes the plan herself, mid-conversation. */
  it('keeps the active plan callable, because it is the one dossier fact that changes mid-turn', () => {
    expect(alwaysOnToolNames()).toContain('get_active_plan');
  });

  it('carries far fewer definitions than the eighteen reads it replaced', () => {
    // 13 as of 2026-08-30 (`update_repertoire` joined ALWAYS_ACTIONS — owner ruling from the
    // piano conversation: handed a list of known pieces, she must store it, and the trigger
    // arrives mid-plan-edit, the exact shape the tail measured at 0-of-3). Previously 12
    // (MP21/MP40 added `log_meal`) — still far under the 18 reads this tiering replaced, and
    // under the 24-tool total from before the split. Bump this deliberately, one at a time,
    // rather than loosening it to something that stops noticing growth.
    expect(coachToolDefinitions().length).toBeLessThan(14);
  });

  /** The whole point. A read in the tail costs zero tokens per turn, so reads are free to add. */
  it('costs nothing per turn to have an on-demand read', () => {
    const offered = new Set(coachToolDefinitions().map((d) => d.function.name));
    const tail = onDemandToolNames();
    expect(tail.length).toBeGreaterThan(5);
    for (const n of tail) expect(offered.has(n)).toBe(false);
  });

  /** Not offered is not the same as not reachable — the executor must still honour the tail. */
  it('still accepts a call to anything in the tail', () => {
    const known = coachToolNames();
    for (const n of onDemandToolNames()) expect(known.has(n)).toBe(true);
  });
});

/**
 * The invariant that a careless change breaks silently, and that broke during this very build:
 * `use_tool` was DECLARED to the model and missing from the executable set, so the model could
 * emit a call the harness then dropped on the floor — and dropping it ends the turn with the model
 * mid-thought and nobody told. Declared and executable must be the same set, both ways.
 */
describe('declared and executable are the same set', () => {
  it('every tool offered to the model can actually be run', () => {
    const known = coachToolNames();
    for (const d of coachToolDefinitions()) expect(known.has(d.function.name)).toBe(true);
  });

  it('every runnable name is either offered or reachable through use_tool', () => {
    const offered = new Set(coachToolDefinitions().map((d) => d.function.name));
    const tail = new Set(onDemandToolNames());
    for (const n of coachToolNames()) expect(offered.has(n) || tail.has(n)).toBe(true);
  });
});

describe('find_tools', () => {
  it('finds a tool by a word the user would actually say', () => {
    expect(searchTools('workouts').names).toContain('get_workout_history');
    expect(searchTools('journal').names).toContain('get_journal');
    expect(searchTools('recipes').names).toContain('get_nutrition');
  });

  it('lists everything when asked for nothing in particular', () => {
    expect(searchTools('').names).toEqual(onDemandToolNames());
    expect(searchTools('   ').names).toEqual(onDemandToolNames());
  });

  /**
   * A dead end leaves her stuck, but a SILENT fallback is worse: she asked for sleep tracking, got
   * ten unrelated tools, and reaches for the nearest one. Owner: *"it would be better for her to
   * look and tell the user 'I don't actually have a tool for that today' than to not look; to not
   * report; to pretend she's doing something she's not."* So the list still comes back — flagged.
   */
  it('flags a miss instead of quietly handing back the whole list', () => {
    const r = searchTools('astrology horoscope');
    expect(r.names.length).toBeGreaterThan(0);
    expect(r.noMatch).toBe(true);
  });

  it('tells her to say so plainly when nothing matches', async () => {
    const out = await COACH_META_TOOLS.find_tools!.run('u1', { query: 'astrology horoscope' });
    expect(out).toMatch(/NOTHING matches/);
    expect(out).toMatch(/do not have a way to do that today/i);
  });

  /** The hierarchy the demotion depends on: name a category, get its members. */
  it('drills down by category, which is what the manifest teaches her to do', () => {
    const r = searchTools('food');
    expect(r.noMatch).toBe(false);
    expect(r.names).toContain('get_nutrition');
    expect(r.names).not.toContain('get_journal');
  });

  /**
   * The tail is READS only now. Four actions were demoted into it for ~1,400 tokens a turn and the
   * measurement went against it: `log_session` (always-on) was called 4 of 4 times, while
   * `update_constraint` (behind find_tools) was found 3 of 3 and called 0. Being chosen is what an
   * action is, so an action she has to go and find is an action that does not happen.
   *
   * The marking stays in `catalogLine` — a future demotion would need it, and the honesty of
   * "[changes their data]" should not depend on nobody ever demoting an action again.
   */
  it('keeps every action out of the tail — an action she has to find is one she does not call', () => {
    const tail = new Set(onDemandToolNames());
    for (const d of DOSSIER_FUNCTIONS) expect(tail.has(d)).toBe(false);
    for (const a of coachActionNames()) expect(tail.has(a), `${a} must be always-on — ${HOW}`).toBe(false);
  });

  it('still fills the tail with the long-tail reads, which stay free', () => {
    const tail = new Set(onDemandToolNames());
    expect(tail.has('get_workout_history')).toBe(true);
    expect(tail.has('get_journal')).toBe(true);
    expect(tail.size).toBeGreaterThan(4);
  });

  it('returns real names with their instructions, so the next call can be right', async () => {
    const out = await COACH_META_TOOLS.find_tools!.run('u1', { query: 'workouts' });
    expect(out).toContain('get_workout_history');
    expect(out).toContain(RETRIEVAL_FUNCTIONS.get_workout_history!.description.slice(0, 40));
  });
});

/**
 * The consolidation. Four food reads became one door with a `view`, so the choice is now two easy
 * ones ("is this about food", then a named view) instead of one hard one between four siblings.
 * Two of the audit's eight tiebreak pairs existed only to help her make that hard choice.
 */
describe('the nutrition facade', () => {
  it('offers one food tool, not four', () => {
    const tail = new Set(onDemandToolNames());
    expect(tail.has('get_nutrition')).toBe(true);
    for (const covered of ['get_food_log', 'get_macro_targets', 'get_recipes', 'lookup_food']) {
      expect(tail.has(covered), `${covered} is covered by get_nutrition — ${HOW}`).toBe(false);
    }
  });

  /** Hidden from HER is not removed from the registry: the Broker still prefetches them by name. */
  it('keeps the four it covers callable, so the Broker can still prefetch them', () => {
    for (const covered of ['get_food_log', 'get_macro_targets', 'get_recipes', 'lookup_food']) {
      expect(RETRIEVAL_FUNCTIONS[covered]).toBeDefined();
    }
  });

  it('teaches every view in the description, since the Broker never sees the schema', () => {
    const d = RETRIEVAL_FUNCTIONS.get_nutrition!.description;
    for (const view of ['log', 'targets', 'recipes', 'lookup']) expect(d).toContain(`"${view}"`);
  });

  it('renders through to the view it was asked for', () => {
    const inner = { days: 7, meals: [] };
    const spy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_food_log!, 'render').mockReturnValue('FOOD LOG TEXT');
    try {
      expect(RETRIEVAL_FUNCTIONS.get_nutrition!.render({ view: 'log', inner })).toBe('FOOD LOG TEXT');
    } finally {
      spy.mockRestore();
    }
  });

  /** An unknown view must not throw the turn away — the commonest view is the safe default. */
  it('falls back to the log rather than failing on a view it does not know', async () => {
    const spy = vi.spyOn(RETRIEVAL_FUNCTIONS.get_food_log!, 'run').mockResolvedValue({ marker: true });
    try {
      const out = (await RETRIEVAL_FUNCTIONS.get_nutrition!.run('u1', { view: 'nonsense' })) as { view: string };
      expect(out.view).toBe('log');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('use_tool', () => {
  it('refuses a name it does not know, and says how to find the real one', async () => {
    const out = await COACH_META_TOOLS.use_tool!.run('u1', { name: 'get_nonsense' });
    expect(out).toMatch(/no readable tool/i);
    expect(out).toContain('find_tools');
  });

  /** An ALWAYS-ON action is called directly, never through here — it was never in the tail. */
  it('will not run an always-on action through use_tool — and says where it actually lives', async () => {
    const out = await COACH_META_TOOLS.use_tool!.run('u1', { name: 'propose_plan_change' });
    expect(out).toContain('declared directly');
    // Never the catalog pointer: sending her to find_tools for a tool she is HOLDING burns rounds.
    expect(out).not.toContain('find_tools');
  });

  /**
   * The fault text is a steering wheel. "Call find_tools" on a DOSSIER name was a deterministic
   * misdirection — measured 2026-08-20 on the owner's session, three turns in a row:
   * use_tool("get_weight") → sent to the catalog → find_tools → round cap → the turn ended with a
   * promise instead of his numbers. The honest answer to a dossier name is "you are holding it".
   */
  it('a dossier fact answers "already in your context", never "call find_tools"', async () => {
    for (const name of ['get_identity', 'get_weight']) {
      const out = await COACH_META_TOOLS.use_tool!.run('u1', { name });
      expect(out).toContain('ALREADY IN YOUR CONTEXT');
      expect(out).not.toContain('find_tools');
    }
  });
});

/**
 * The gate the checklist promises (TOOL-HARNESS.md, "Adding a tool", step 2).
 *
 * She reaches the tail by drilling into a named category, so a tool filed in none is a tool she has
 * to guess the name of — and the whole demotion rests on her being able to find things without
 * guessing. Doc rules nobody enforces decay; this is the enforcement.
 */
describe('every tool in the tail is filed where she can find it', () => {
  it('leaves nothing uncategorised', () => {
    const filed = new Set(TOOL_CATEGORIES.flatMap((c) => c.members));
    const orphans = onDemandToolNames().filter((n) => !filed.has(n));
    expect(orphans, HOW).toEqual([]);
  });

  it('files nothing that is not actually in the tail — a stale entry is a dead end', () => {
    const tail = new Set(onDemandToolNames());
    const stale = TOOL_CATEGORIES.flatMap((c) => c.members).filter((m) => !tail.has(m));
    expect(stale, HOW).toEqual([]);
  });

  it('gives every category a plain-words label, since the manifest says them out loud', () => {
    for (const c of TOOL_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(8);
      expect(c.key).toMatch(/^[a-z]+$/);
    }
  });
});
