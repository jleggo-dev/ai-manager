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
   * A budget, not a limit — this block is injected ONCE at session open, not per turn, so the cost
   * is ~1.1k tokens per conversation. Raised 4000 → 4600 on 2026-08-16 because the manifest was
   * already sitting at 3988 and the thing it needed was the "do these, do not describe them"
   * instruction: the coach had just answered "can you change the plan?" by reciting this list back
   * near-verbatim instead of calling the tool. Text that stops her narrating the manifest earns its
   * place in the manifest. Keep the ceiling — when the next thing wants in, cut something first.
   */
  it('stays small enough to ride every session open', () => {
    expect(renderCapabilities({ healthAvailable: true }).length).toBeLessThan(4600);
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
