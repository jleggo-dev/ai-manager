/**
 * "Screen during a sit" is a per-device preference (owner, 2026-11-03). Dark is the answer unless
 * this phone was told otherwise — including when nothing is stored, when the stored value is
 * garbage, and when the store itself throws (private mode, a disabled store): a sit must never
 * light the screen because a read failed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIT_SCREEN_KEY, readSitScreen, writeSitScreen } from './sit-screen.ts';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('sit-screen', () => {
  it('reads dark when nothing is stored', () => {
    expect(readSitScreen()).toBe('dark');
  });

  it('round-trips both values', () => {
    writeSitScreen('on');
    expect(readSitScreen()).toBe('on');
    expect(window.localStorage.getItem(SIT_SCREEN_KEY)).toBe('on');
    writeSitScreen('dark');
    expect(readSitScreen()).toBe('dark');
  });

  it('reads dark for a value it does not know', () => {
    window.localStorage.setItem(SIT_SCREEN_KEY, 'bright');
    expect(readSitScreen()).toBe('dark');
  });

  it('reads dark when the store throws, and a write that throws is swallowed', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    expect(readSitScreen()).toBe('dark');
    expect(() => writeSitScreen('on')).not.toThrow();
  });
});
