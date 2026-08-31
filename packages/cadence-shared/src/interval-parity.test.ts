import { describe, it, expect } from 'vitest';
import { buildParityFixture, type ParityFixture } from './interval-parity.ts';
// Imported rather than read from disk: this package has no `@types/node`, and the fixture is a
// checked-in artifact, so a module import is both simpler and typed.
import fixtureJson from '../interval-parity.json' with { type: 'json' };

/**
 * The TypeScript half of the engine parity check.
 *
 * This asserts `interval.ts` still produces the checked-in fixture. The Swift half
 * (`apps/cadence-ios/ios/App/CadenceWatch/Tests/IntervalParityCheck.swift`, run by
 * `npm run check:interval-parity`) asserts `IntervalEngine.swift` produces the SAME file. Two
 * implementations, one artifact — which is the only way "KEEP IN LOCKSTEP" is enforceable rather
 * than aspirational.
 *
 * A failure here means the engine changed. If that was deliberate, regenerate with
 * `npm run gen:interval-parity` and review the diff; then run the Swift check, which will now
 * fail until the port is updated to match.
 */
const fixture = fixtureJson as ParityFixture;

describe('interval engine parity fixture', () => {
  it('is what interval.ts produces today', () => {
    expect(buildParityFixture()).toEqual(fixture);
  });

  it('covers the shapes most likely to drift in a hand port', () => {
    const names = fixture.cases.map((c) => c.name);
    expect(names).toContain('emom 60/0 x10'); // zero recovery emits no phase at all
    expect(names).toContain('two sets with rest'); // rest sits outside the rounds
    expect(names).toContain('over every bound'); // clamps and trim-to-fit
    expect(fixture.cases.length).toBeGreaterThanOrEqual(9);
  });

  it('pins an EMOM to work-only phases — the classic port mistake', () => {
    const emom = fixture.cases.find((c) => c.name === 'emom 60/0 x10');
    expect(emom?.phases.every((p) => p.kind === 'work')).toBe(true);
    expect(emom?.phases.length).toBe(10);
  });

  it("pins that a set's rest is never multiplied by its rounds", () => {
    const two = fixture.cases.find((c) => c.name === 'two sets with rest');
    expect(two?.phases.filter((p) => p.label === 'Rest').length).toBe(1);
  });
});
