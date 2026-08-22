/**
 * CAN SHE ACTUALLY GET AT IT? — the question none of the existing gates ask.
 *
 * `coach-meta-tools.test.ts` checks the catalog is well-formed and `description-audit.test.ts`
 * checks the words. Neither asks whether a fact she needs can be REACHED, and that gap cost two
 * days: asked to set nutrition targets on 2026-08-22, she made twelve successful tool calls across
 * two sessions and never once reached `set_macro_targets`, because the weight she needed first was
 * unreachable by every route at the same time.
 *
 *   not injected  — `get_weight` was not in the per-turn floor
 *   not findable  — dossier facts are excluded from `onDemandToolNames()`, so `find_tools` could
 *                   not return it; it answered with unrelated tools under "now LOADED and callable"
 *   not callable  — `use_tool` refused it, on the grounds it was "already in your context"
 *
 * Each of the three was defensible alone. Together they made a fact that was sitting in the
 * database unobtainable. These tests pin the invariant that ties them: **a dossier fact is either
 * in the turn floor, or it is runnable — never neither.**
 */
import { describe, it, expect } from 'vitest';
import { DOSSIER_FUNCTIONS, TURN_FLOOR_FUNCTIONS, onDemandToolNames, ALWAYS_ACTIONS } from './coach-tool-tiers.ts';
import { searchTools, COACH_META_TOOLS } from './coach-meta-tools.ts';

const USE_TOOL = COACH_META_TOOLS.use_tool!;
const FIND_TOOLS = COACH_META_TOOLS.find_tools!;
const USER = '00000000-0000-4000-8000-000000000001';

describe('every dossier fact is reachable by some route', () => {
  /** The invariant the incident violated. Neither route open = a fact that does not exist to her. */
  it.each([...DOSSIER_FUNCTIONS])('%s is either in the turn floor or runnable via use_tool', async (name) => {
    const inFloor = (TURN_FLOOR_FUNCTIONS as readonly string[]).includes(name);
    if (inFloor) return;

    const out = await USE_TOOL.run(USER, { name });
    // Not a refusal: it either answers, or says nothing is on file and to ask. Both are progress.
    expect(out).not.toMatch(/is not a tool because/i);
    expect(out).not.toMatch(/There is no readable tool called/i);
  });

  it('get_weight specifically is in the floor — the fact the incident was about', () => {
    expect(TURN_FLOOR_FUNCTIONS as readonly string[]).toContain('get_weight');
  });

  /**
   * Allergies. `get_dietary_profile` is a dossier fact and NOT in the floor, so if `use_tool` also
   * refused it, a compacted session would leave her unable to check what someone cannot eat.
   */
  it('the dietary profile can always be read, compaction or not', async () => {
    const out = await USE_TOOL.run(USER, { name: 'get_dietary_profile' });
    expect(out).not.toMatch(/is not a tool because|no readable tool/i);
  });
});

describe('find_tools answers for facts she already holds', () => {
  /** The exact query from the production log, 2026-08-22 13:57. */
  it('a search for body stats names the fact instead of offering unrelated tools', async () => {
    const out = await FIND_TOOLS.run(USER, { query: 'weight, height, age, body stats' });
    expect(out).toMatch(/ALREADY HAVE/);
    expect(out).toMatch(/get_weight/);
  });

  it('surfaces the match through searchTools too, so the two cannot drift', () => {
    expect(searchTools('weight').alreadyHave).toContain('get_weight');
  });

  /** A query with no dossier bearing must not grow a spurious "you already have" preamble. */
  it('says nothing about the dossier when the query is not about one', async () => {
    const out = await FIND_TOOLS.run(USER, { query: 'recipes' });
    expect(out).not.toMatch(/ALREADY HAVE/);
  });
});

describe('the action she never reached', () => {
  it('set_macro_targets is offered every turn — it was never a discovery problem', () => {
    expect(ALWAYS_ACTIONS as readonly string[]).toContain('set_macro_targets');
  });

  /** Always-on actions must not also be reachable through use_tool: two doors, two behaviours. */
  it('and is not duplicated into the on-demand tail', () => {
    expect(onDemandToolNames()).not.toContain('set_macro_targets');
  });
});
