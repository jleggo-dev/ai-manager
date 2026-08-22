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
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';

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

/**
 * THE FACTS SHE HAD TO ASK FOR ANYWAY (owner, 2026-08-22, after targets finally got set).
 *
 * "Cadence had to re-ask my age, height, weight — even though those were set during on-boarding.
 * She also had to re-ask me for my weight loss goal, which she had previously."
 *
 * Weight had just been fixed. Age and height were a different failure with the same shape and a
 * worse cause: they were on file and NO tool returned them at all, so there was nothing to reach.
 * Objectives were reachable but not re-sent, so they survived exactly as long as the session did.
 *
 * The brand promise is "never makes you repeat yourself". These are the facts that promise is
 * about, so they get a gate rather than a note.
 */
describe('the onboarding facts survive a compacted session', () => {
  const bodyFacts = RETRIEVAL_FUNCTIONS.get_weight!;

  it('body facts include height and age, not just weight', () => {
    const rendered = bodyFacts.render?.({
      current: 88.5,
      start: 90,
      unit: 'kg',
      height_cm: 178,
      age: 41,
    });
    expect(rendered).toMatch(/Height: 178cm/);
    expect(rendered).toMatch(/Age: 41/);
  });

  /** Metric was the visible half of the complaint: he gave pounds and was answered in kilos. */
  it('reads weight back in the unit the user gave', () => {
    const asLb = bodyFacts.render?.({ current: 88.5, start: null, unit: 'lb' });
    expect(asLb).toMatch(/195\.1lb/);
    expect(asLb).not.toMatch(/kg/);

    const asKg = bodyFacts.render?.({ current: 88.5, start: null, unit: 'kg' });
    expect(asKg).toMatch(/88\.5kg/);
  });

  /**
   * CONVERTED, NOT EXPLAINED. The first version appended "talk about weight in lb, it is the unit
   * they gave" — a rule to follow, spent on every turn forever, and one more thing to get wrong.
   * Owner's correction (2026-08-22): convert at the boundary and hand over a number that is
   * already right. The unit is in the string; nothing is left to reason about.
   */
  it('carries no instruction — the number arrives already correct', () => {
    const rendered = bodyFacts.render?.({ current: 88.5, unit: 'lb', height_cm: 178, age: 41 });
    expect(rendered).toBe('Weight: 195.1lb · Height: 178cm · Age: 41');
    expect(rendered).not.toMatch(/talk about|unit they gave|convert/i);
  });

  /** A body fact that is absent must stay absent — not render as a blank or a zero. */
  it('omits what is not on file rather than inventing a shape for it', () => {
    const rendered = bodyFacts.render?.({ current: 88.5, start: null, unit: 'kg', height_cm: null, age: null });
    expect(rendered).toMatch(/Weight:/);
    expect(rendered).not.toMatch(/Height|Age|null|undefined/);
  });

  it('objectives ride every turn — a coach does not ask what you are working toward twice', () => {
    expect(TURN_FLOOR_FUNCTIONS as readonly string[]).toContain('get_objectives');
  });
});
