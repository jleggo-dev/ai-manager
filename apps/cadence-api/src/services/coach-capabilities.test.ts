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

  it('stays small enough to ride every session open', () => {
    expect(renderCapabilities({ healthAvailable: true }).length).toBeLessThan(4000);
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

  it('never claims Apple Health is unavailable just because we already asked', () => {
    const out = renderCapabilities({ healthAvailable: true, healthAnswered: true });
    expect(out).not.toContain('Not on this device');
    expect(out).toContain('do not offer');
    expect(out).toMatch(/if they ASK for it/i);
    expect(out).toMatch(/only works on iPhone; they are on one/i);
  });

  it('leaves a fresh, capable device free to be offered', () => {
    const out = renderCapabilities({ healthAvailable: true, healthAnswered: false });
    expect(out).not.toContain('Not on this device');
    expect(out).not.toContain('do not offer');
  });
});
