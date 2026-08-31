import { describe, expect, it, vi } from 'vitest';
import { healConstraintsShape } from './users.ts';

/**
 * The 2026-08-31 boot-brick, as a unit: constraints stored as a JSON STRING (a double-encoded
 * maintenance write) crashed the phone at startup and 500'd the coach turn. The read now heals:
 * a parseable string unwraps, garbage floors to empty, a healthy array is untouched.
 */
describe('healConstraintsShape', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  it('unwraps a JSON-string list back into the array it contains', () => {
    const spy = warn();
    const baseline: Record<string, unknown> = {
      constraints: JSON.stringify([{ id: 'a', label: 'tendinitis in left knee', plan_around: true }]),
    };
    healConstraintsShape(baseline, 'u1');
    expect(baseline.constraints).toEqual([{ id: 'a', label: 'tendinitis in left knee', plan_around: true }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('floors an unparseable string to none-on-file instead of throwing', () => {
    const spy = warn();
    const baseline: Record<string, unknown> = { constraints: 'not json at all' };
    healConstraintsShape(baseline, 'u1');
    expect(baseline.constraints).toEqual([]);
    spy.mockRestore();
  });

  it('floors a non-array, non-string shape to none-on-file', () => {
    const spy = warn();
    const baseline: Record<string, unknown> = { constraints: { label: 'knee' } };
    healConstraintsShape(baseline, 'u1');
    expect(baseline.constraints).toEqual([]);
    spy.mockRestore();
  });

  it('leaves a healthy array and an absent key completely alone', () => {
    const list = [{ id: 'a', label: 'elbow' }];
    const withList: Record<string, unknown> = { constraints: list };
    healConstraintsShape(withList, 'u1');
    expect(withList.constraints).toBe(list);

    const without: Record<string, unknown> = {};
    healConstraintsShape(without, 'u1');
    expect('constraints' in without).toBe(false);
  });
});
