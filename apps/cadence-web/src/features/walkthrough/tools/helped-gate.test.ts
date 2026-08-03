import { describe, expect, it } from 'vitest';
import { markHelpedAsked, mayAskHelped } from './helped-gate.ts';

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('the once-a-day "did that help?" gate', () => {
  it('asks when it has never asked', () => {
    expect(mayAskHelped(fakeStorage())).toBe(true);
  });

  it('does not ask twice on the same day, across ANY mind surface', () => {
    const s = fakeStorage();
    markHelpedAsked(s);
    expect(mayAskHelped(s)).toBe(false);
  });

  it('asks again on a new day', () => {
    const s = fakeStorage({ 'cadence.helpedAskedOn': '2001-01-01' });
    expect(mayAskHelped(s)).toBe(true);
  });

  it('degrades to asking when storage is unavailable — never to crashing', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(mayAskHelped(broken)).toBe(true);
    expect(() => markHelpedAsked(broken)).not.toThrow();
  });
});
