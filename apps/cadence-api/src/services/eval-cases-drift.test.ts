import { describe, it, expect } from 'vitest';
import { alwaysOnToolNames, onDemandToolNames } from './coach-tool-tiers.ts';
import { CASES, KNOWN_TOOLS } from '../../scripts/eval-tool-selection-cases.ts';

/**
 * The eval must measure the harness that exists, not the one it was written against.
 *
 * On 2026-08-29 it did not. `KNOWN_TOOLS` was a hand-maintained copy, and it had drifted in BOTH
 * directions at once: it still named four tools the harness had hidden behind the `get_nutrition`
 * facade (`lookup_food`, `get_food_log`, `get_recipes`, `get_macro_targets`), and knew nothing of
 * nine it exposes — `get_nutrition`, `find_tools` and `use_tool` among them.
 *
 * The damage was not noise, it was direction. The run reported *"invented tool names: find_tools,
 * get_nutrition, use_tool"* — three real, live, correct tools called hallucinations — and case B3
 * ("how much protein is in 100g of halloumi") expected a tool the model could not call, so doing
 * the right thing scored as BOTH a miss and an invention. The headline "19% called nothing where a
 * tool was needed" was therefore partly an artefact of the instrument. Anyone tuning the coach
 * against that number would have tuned it toward tools that no longer exist.
 *
 * `KNOWN_TOOLS` is now derived from the harness, so that particular rot is structurally impossible.
 * What is NOT structural is the case bodies: `expect`, `allow` and `forbid` are hand-written
 * strings, and nothing stops one naming a tool that has since been renamed or hidden. That is what
 * this test is for.
 */

const liveTools = new Set([...alwaysOnToolNames(), ...onDemandToolNames()]);

/** Reads the Broker prefetches into the pack — real, but never declared to the model. */
const DOSSIER = new Set([
  'get_identity',
  'get_objectives',
  'get_active_plan',
  'get_consistency',
  'get_constraints',
  'get_weight',
  'get_equipment',
  'get_dietary_profile',
  'get_health_history',
]);

const reachable = (name: string): boolean => liveTools.has(name) || DOSSIER.has(name);

describe('the eval names tools that actually exist', () => {
  it('never EXPECTS a tool the harness does not expose', () => {
    const bad = CASES.flatMap((c) =>
      (c.expect ?? []).filter((t) => !reachable(t)).map((t) => `${c.id} expects "${t}"`),
    );
    expect(bad, 'A case expecting an unreachable tool can never pass — it scores correct behaviour as a miss.').toEqual(
      [],
    );
  });

  it('never ALLOWS a tool the harness does not expose', () => {
    const bad = CASES.flatMap((c) => (c.allow ?? []).filter((t) => !reachable(t)).map((t) => `${c.id} allows "${t}"`));
    expect(bad, 'A stale allow entry silently understates precision when the real tool is called instead.').toEqual([]);
  });

  /**
   * A forbid on an unreachable tool is DEAD — it can never fire, so the case looks like it is
   * guarding something and is guarding nothing. That is worse than an absent guard, because it
   * reads as covered.
   */
  it('never FORBIDS a tool the harness does not expose', () => {
    const bad = CASES.flatMap((c) =>
      (c.forbid ?? []).filter((t) => !reachable(t)).map((t) => `${c.id} forbids "${t}"`),
    );
    expect(bad, 'A forbid that can never fire is a guard in name only.').toEqual([]);
  });

  it('asserts arguments only on a tool the same case can actually see', () => {
    const bad = CASES.filter((c) => c.args && !reachable(c.args.tool)).map(
      (c) => `${c.id} asserts args on "${c.args!.tool}"`,
    );
    expect(bad).toEqual([]);
  });

  it('KNOWN_TOOLS covers every live tool, so none is ever reported as invented', () => {
    const missing = [...liveTools].filter((t) => !KNOWN_TOOLS.has(t));
    expect(missing, 'A live tool absent here is scored as a hallucination when the coach calls it.').toEqual([]);
  });

  /** Provenance is the rule this file states about itself; a case with none cannot be judged. */
  it('every case still cites where it came from', () => {
    expect(CASES.filter((c) => !c.from?.trim()).map((c) => c.id)).toEqual([]);
  });
});
