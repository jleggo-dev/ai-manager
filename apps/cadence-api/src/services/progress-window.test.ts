import { describe, it, expect } from 'vitest';
import { LEGACY_WINDOW_CONFIG, parseProgressWindow, resolveWindowConfig } from './progress-window.ts';

describe('resolveWindowConfig', () => {
  it('omitted window -> the legacy (pre-window, backwards-compatible) config', () => {
    expect(resolveWindowConfig(undefined)).toEqual(LEGACY_WINDOW_CONFIG);
    expect(resolveWindowConfig()).toEqual({ seriesDays: 90, consistencyDays: 7, historyCap: 40 });
  });

  it('week -> 7d series / 7d consistency / 20 history rows', () => {
    expect(resolveWindowConfig('week')).toEqual({ seriesDays: 7, consistencyDays: 7, historyCap: 20 });
  });

  it('month -> 35d series / 35d consistency / 40 history rows', () => {
    expect(resolveWindowConfig('month')).toEqual({ seriesDays: 35, consistencyDays: 35, historyCap: 40 });
  });

  it('all -> 1825d series / 35d consistency / 80 history rows', () => {
    expect(resolveWindowConfig('all')).toEqual({ seriesDays: 1825, consistencyDays: 35, historyCap: 80 });
  });
});

describe('parseProgressWindow', () => {
  it('accepts the three named windows', () => {
    expect(parseProgressWindow('week')).toBe('week');
    expect(parseProgressWindow('month')).toBe('month');
    expect(parseProgressWindow('all')).toBe('all');
  });

  it('anything else (missing, garbage, array from a repeated query param) is undefined, never a throw', () => {
    expect(parseProgressWindow(undefined)).toBeUndefined();
    expect(parseProgressWindow('')).toBeUndefined();
    expect(parseProgressWindow('bogus')).toBeUndefined();
    expect(parseProgressWindow(['week', 'month'])).toBeUndefined();
  });
});
