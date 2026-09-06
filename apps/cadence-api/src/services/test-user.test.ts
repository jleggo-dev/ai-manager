import { describe, it, expect } from 'vitest';
import { testName, testNamePrefix, testUserId } from './test-user.ts';

/**
 * Concurrency isolation only works if EVERY handle a suite uses to find its own rows carries the
 * process. `testUserId` did; fixture names did not, and the gap is invisible until two runs
 * overlap — at which point one process's row disappears between two of another's statements and
 * the failure looks like a bug in whatever was being tested.
 *
 * That is not hypothetical: on 2026-09-05 it reddened a PR whose entire diff was an Info.plist
 * key and two docs files, by failing an assertion that a private food had survived — in a suite
 * whose subject cannot delete private foods at all. So the agreement between the two mechanisms
 * is pinned here rather than left as a convention.
 */
describe('test isolation handles all carry the same process', () => {
  const pid = (process.pid >>> 0).toString(16).padStart(8, '0').slice(-8);

  it('puts this process in the user id', () => {
    expect(testUserId('a110')).toBe(`00000000-0000-4000-a000-a110${pid}`);
  });

  it('puts the SAME process in fixture names', () => {
    expect(testNamePrefix()).toContain(pid);
    expect(testUserId('a110')).toContain(pid);
  });

  it('sweeps by a prefix that actually matches what it makes', () => {
    expect(testName('Latte').startsWith(testNamePrefix())).toBe(true);
    expect(testName('Salmon').startsWith(testNamePrefix())).toBe(true);
  });

  /**
   * THE REGRESSION. A fixture name must not sit in a namespace that a static sweep can reach:
   * `delete from cadence.foods where name like 'Zzq Test%'` is what one suite actually ran, and
   * it deleted every concurrent run's rows as well as its own. A name that no longer matches that
   * pattern is a name another process cannot take out from under this one.
   */
  it('does not sit in the globally-swept namespace it used to', () => {
    const globallySwept = (name: string) => name.startsWith('Zzq Test');
    expect(globallySwept('Zzq Test Latte')).toBe(true); // what it used to be
    expect(globallySwept(testName('Latte'))).toBe(false); // what it is now
  });

  it('still reads as obviously synthetic, so stray rows are recognisable', () => {
    expect(testName('Latte').startsWith('Zzq')).toBe(true);
  });

  it('rejects a marker that would not fit the uuid group', () => {
    expect(() => testUserId('nope')).toThrow(/4 hex chars/);
    expect(() => testUserId('a11')).toThrow(/4 hex chars/);
    expect(() => testUserId('a1100')).toThrow(/4 hex chars/);
  });
});
