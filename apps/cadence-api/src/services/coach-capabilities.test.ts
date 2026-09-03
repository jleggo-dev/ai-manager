import { describe, it, expect } from 'vitest';
import { SESSION_TOOL_KINDS } from '@cadence/shared';
import { renderCapabilities, CAPABILITIES, NOT_YET } from './coach-capabilities.ts';

describe('coach capability manifest', () => {
  it('names every session tool the app can actually play, so the coach never invents one', () => {
    const out = renderCapabilities({ healthAvailable: true });
    for (const kind of SESSION_TOOL_KINDS) expect(out).toContain(kind);
  });

  it('carries both halves — what the product does and what a step can be', () => {
    const out = renderCapabilities({ healthAvailable: true });
    expect(out).toContain('WHAT CADENCE CAN DO');
    expect(out).toContain('WAYS A STEP CAN BE PLAYED');
    for (const g of CAPABILITIES) expect(out).toContain(g.heading);
  });

  it('states the honest "not yet" list so an unsupported ask gets a real answer', () => {
    const out = renderCapabilities();
    for (const n of NOT_YET) expect(out).toContain(n);
  });

  it('suppresses the Apple Health offer off-device (the permission card cannot appear there)', () => {
    expect(renderCapabilities({ healthAvailable: false })).toContain('Not on this device: Apple Health');
    expect(renderCapabilities({ healthAvailable: true })).not.toContain('Not on this device');
  });

  /**
   * A budget, not a limit — this block is injected ONCE at session open, not per turn.
   *
   * 4000 → 4600 (2026-08-16): the manifest was already at 3988 and needed the "do these, do not
   * describe them" instruction, after the coach answered "can you change the plan?" by reciting
   * this list back near-verbatim instead of calling the tool.
   *
   * 4600 → 5300 (2026-08-16, same day): the categories block. This is the trade that pays for
   * itself many times over and the arithmetic is worth writing down — tool definitions ride EVERY
   * turn, this rides once:
   *
   *   tool definitions   18,380 → 5,682 chars   per TURN     (24 tools → 5)
   *   this manifest       4,600 → 5,176 chars   per SESSION
   *
   * A ten-turn conversation pays ~576 characters once to save ~127,000. It is only allowed to be
   * a good trade because the text bought is precisely what makes the demotion safe: she cannot
   * drill down into a hierarchy she has not been told exists.
   *
   * Keep the ceiling. The next thing that wants in has to cut something or show its own arithmetic.
   *
   * 5300 → 5400 (2026-08-30, repertoire): +111 chars/session, measured — 63 for the fold into
   * "remember what you told me" (no capability line of its own) and 48 for the `practice`
   * category line riding categoryLines(). Renders at 5365, so real headroom under 5400 is 35
   * chars. The arithmetic that buys it: the category line is what lets `get_repertoire` live in
   * the FREE tail and still be found; the alternative, an always-on read, would cost ~100 tokens
   * (~400 chars) per TURN forever. 111 chars a session buying ~400 a turn is the same trade the
   * header calls good, an order of magnitude smaller.
   *
   * 5400 → 5560 (2026-08-30, the progress talk — and a debt repaid): main was measured at 5417
   * BEFORE this change, already over its own cap — repertoire's "renders at 5365" accounting went
   * stale between measuring and merging, and its pipeline never ran this suite. 17 of this bump
   * repays that. The other ~96 is the Progress-page capability line, and the eval measured the
   * cost of its omission directly (A19): asked to reshape the page, she answered "that's not
   * something I can control from here" WHILE holding the drawer label for the tool — the
   * manifest's silence outranked the label. The manifest and the drawer must name the same
   * abilities.
   *
   * ⚠ That row's "renders at 5513; headroom 47" was WRONG on the day it was written, and this is
   * the correction: main measured 5,549 immediately before the 2026-09-03 change below, with the
   * same code the row describes. The claim was 36 characters out, which is most of the headroom it
   * claimed — the same stale-accounting mistake the row above it repays for repertoire, made again
   * in the act of repaying it. MEASURE, then write the number down.
   *
   * 5560 → 5736 (2026-09-03, the collection line). Measured either side of the change with
   * `renderCapabilities({ healthAvailable: true }).length`:
   *
   *   before  5,549
   *   after   5,676   (+127, the one capability line)
   *   cap     5,736   (after + 60 headroom)
   *
   * What the 127 buys: `offer_repertoire_review` has carried a drawer hook since it shipped, and
   * the A19 measurement is what this list costs when it is silent — she answered "that's not
   * something I can control from here" WHILE holding the hook for the tool. A capability the drawer
   * names and the manifest does not is a capability she talks herself out of.
   */
  it('stays small enough to ride every session open', () => {
    expect(renderCapabilities({ healthAvailable: true }).length).toBeLessThan(5736);
  });

  /**
   * The demotion depends entirely on this: only five tools are declared per turn, so a request
   * needing anything else requires her to LOOK. Owner: *"the real risk is her not looking."*
   */
  it('names the categories and tells her to look before answering', () => {
    const out = renderCapabilities({ healthAvailable: true });
    expect(out).toContain('find_tools');
    expect(out).toMatch(/LOOK before answering/);
    for (const key of ['training', 'practice', 'body', 'food', 'writing', 'changes']) expect(out).toContain(key);
  });

  /** Looking and saying "no" beats not looking, and beats implying you did something you did not. */
  it('tells her to say plainly when there is no tool, rather than pretend', () => {
    const out = renderCapabilities({ healthAvailable: true });
    expect(out).toMatch(/cannot do that today/);
    expect(out).toMatch(/never imply you did something you did not/i);
  });

  /**
   * The duplicated-reply failure, 2026-08-16: on both turns that ran the tool loop — and neither
   * that did not — her answer came back as two complete drafts concatenated. She writes a whole
   * reply, calls the tool, and the continuation writes the whole reply again from scratch, because
   * a Responses-API continuation is a fresh generation that does not know what already streamed.
   * The lever we own is telling her to keep the pre-call line short.
   */
  it('tells her to keep the line before a tool call short, so the continuation cannot repeat it', () => {
    expect(renderCapabilities({ healthAvailable: true })).toMatch(/ONE short line before a tool call/);
  });

  /** The fix for a real device failure, so it is pinned rather than left to survive by luck. */
  it('tells her to call the tool rather than explain what the tool would do', () => {
    const out = renderCapabilities({ healthAvailable: true });
    expect(out).toContain('DO THESE, DO NOT DESCRIBE THEM');
    expect(out).toMatch(/never make them repeat a change they already named/i);
  });

  it('offers the one-thing plan edit, so she knows a swap is possible without a rebuild', () => {
    expect(renderCapabilities({ healthAvailable: true })).toMatch(/change ONE thing in the plan without rebuilding/);
  });
});

/**
 * Owner-reported, 2026-08-10: with Apple Health fully granted on an iPhone, Cadence answered
 * "Can't on this device — Apple Health only works on iPhone." The client was sending
 * `isAvailable() && !alreadyAsked` as one boolean, so "we already asked" arrived as "no Health
 * here" and she repeated it back as fact.
 */
describe('renderCapabilities — availability vs already-asked', () => {
  it('says not-on-this-device only when the device really lacks it', () => {
    expect(renderCapabilities({ healthAvailable: false })).toContain('Not on this device: Apple Health');
  });

  /**
   * She used to be told a confirmation card would appear, so she promised one and waited. On
   * device 2026-08-15: "a prompt will show up for you to confirm" — no prompt could appear, and
   * she sat waiting while the workouts were one tool call away. Reading is hers to do now.
   */
  it('tells her to read Apple Health herself, and never to promise a prompt', () => {
    const out = renderCapabilities({ healthAvailable: true, healthAnswered: true });
    expect(out).not.toContain('Not on this device');
    expect(out).toMatch(/get_workout_history/);
    expect(out).toMatch(/never say a prompt or confirmation/i);
    expect(out).toMatch(/empty read means nothing recorded yet/i);
  });

  it('says the same thing whether or not she has asked before — reading needs no offer', () => {
    const out = renderCapabilities({ healthAvailable: true, healthAnswered: false });
    expect(out).toBe(renderCapabilities({ healthAvailable: true, healthAnswered: true }));
    expect(out).not.toContain('Not on this device');
    expect(out).not.toContain('do not offer');
  });
});
