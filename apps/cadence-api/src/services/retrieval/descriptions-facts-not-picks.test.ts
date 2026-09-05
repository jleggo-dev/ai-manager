import { describe, expect, it } from 'vitest';
import { RETRIEVAL_FUNCTIONS } from './registry.ts';

/**
 * The owner's red line applied to the retrieval tool descriptions (2026-09-03, prompt-bias audit
 * packet C). A tool description says what the tool reads, what it costs and what it hands back —
 * it never tells the coach what to do with an answer, which source to trust, or which tool to
 * reach for first. That adjudication is hers (CLAUDE.md, "the Coach is in control of the
 * software"; docs/cadence/TOOL-HARNESS.md).
 *
 * Each row is one removed steer plus the fact that took its place, so a re-edit that restores the
 * steer fails here instead of quietly re-teaching the coach.
 */
describe('retrieval descriptions carry facts, not picks', () => {
  const desc = (name: string) => {
    const f = RETRIEVAL_FUNCTIONS[name];
    expect(f, `${name} is a registered retrieval function`).toBeTruthy();
    return f!.description;
  };

  it('RV-1: get_macro_targets reports an absent target and names the writer, without ordering one made', () => {
    const d = desc('get_macro_targets');
    expect(d).not.toContain('your cue to work some out');
    expect(d).not.toContain('rather than guessing at portions');
    expect(d).toContain('If they have no targets set, this says so; set_macro_targets writes them.');
  });

  it('RV-2: get_recipes no longer ranks the recipe book above inventing a dish', () => {
    const d = desc('get_recipes');
    expect(d).not.toContain('before inventing a new recipe');
    expect(d).not.toContain('when something in their book would do');
    expect(d).toContain('refer to a saved dish ("that chilli").');
  });

  it('RV-3: read_label states what a label is instead of ranking it above every other source', () => {
    const d = desc('read_label');
    expect(d).not.toContain('most authoritative source');
    expect(d).toContain("the label carries the maker's own printed figures for that exact product");
    // The other side of the comparison is named, so the ranking is hers to make.
    expect(d).toContain('check_food_sources shows what the food databases hold for it');
  });

  it('RV-4: research_food states its cost and the free reads, without gating when it may run', () => {
    const d = desc('research_food');
    expect(d).not.toContain('Use only after');
    expect(d).not.toContain('came up empty');
    expect(d).not.toContain('never for shallots');
    expect(d).not.toContain('sold generically');
    // The facts that let her decide: it is slow and billed, and two reads cost nothing.
    expect(d).toContain('SLOW (minutes) and billed.');
    expect(d).toContain('check_food_sources and lookup_food read the food databases without a web search');
  });

  /** The two removals above took the only "authoritative"/"only after" language in the registry;
   *  this catches the same steer reappearing on a neighbouring food tool. */
  it('no food description ranks one source above another', () => {
    const RANKING = /most authoritative|use only after|always prefer|never use .* unless/i;
    const offenders = Object.values(RETRIEVAL_FUNCTIONS)
      .filter((f) => RANKING.test(f.description))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});
