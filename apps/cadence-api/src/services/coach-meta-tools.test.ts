import { describe, it, expect } from 'vitest';
import { searchTools, COACH_META_TOOLS } from './coach-meta-tools.ts';
import { alwaysOnToolNames, onDemandToolNames, DOSSIER_FUNCTIONS, ALWAYS_ACTIONS } from './coach-tool-tiers.ts';
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
    expect(coachToolDefinitions().length).toBeLessThan(12);
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
    expect(searchTools('recipes').names).toContain('get_recipes');
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
    expect(r.names).toContain('get_food_log');
    expect(r.names).not.toContain('get_journal');
  });

  it('marks an action in the tail as something that changes their data', async () => {
    const out = await COACH_META_TOOLS.find_tools!.run('u1', { query: 'changes' });
    expect(out).toContain('update_goal');
    expect(out).toContain('[changes their data]');
  });

  /** The tail carries the DEMOTED actions (that is the point) but never a dossier fact, and never
   *  an always-on action — those are already in her context and a second door would be a second
   *  path to the same thing. */
  it('carries the demoted actions and nothing she already holds', () => {
    const tail = new Set(onDemandToolNames());
    for (const d of DOSSIER_FUNCTIONS) expect(tail.has(d)).toBe(false);
    for (const a of ALWAYS_ACTIONS) expect(tail.has(a)).toBe(false);
    expect(tail.has('update_goal')).toBe(true);
    expect(tail.has('set_macro_targets')).toBe(true);
  });

  it('returns real names with their instructions, so the next call can be right', async () => {
    const out = await COACH_META_TOOLS.find_tools!.run('u1', { query: 'workouts' });
    expect(out).toContain('get_workout_history');
    expect(out).toContain(RETRIEVAL_FUNCTIONS.get_workout_history!.description.slice(0, 40));
  });
});

describe('use_tool', () => {
  it('refuses a name it does not know, and says how to find the real one', async () => {
    const out = await COACH_META_TOOLS.use_tool!.run('u1', { name: 'get_nonsense' });
    expect(out).toMatch(/no readable tool/i);
    expect(out).toContain('find_tools');
  });

  /** An ALWAYS-ON action is called directly, never through here — it was never in the tail. */
  it('will not run an always-on action through use_tool', async () => {
    const out = await COACH_META_TOOLS.use_tool!.run('u1', { name: 'propose_plan_change' });
    expect(out).toMatch(/no readable tool/i);
  });

  it('will not run a dossier fact through the read door either', async () => {
    const out = await COACH_META_TOOLS.use_tool!.run('u1', { name: 'get_identity' });
    expect(out).toMatch(/no readable tool/i);
  });
});
