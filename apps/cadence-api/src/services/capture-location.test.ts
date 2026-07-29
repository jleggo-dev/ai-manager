import { describe, it, expect } from 'vitest';
import { extractCity } from './capture-location.ts';

describe('extractCity', () => {
  it('reads a flat string, trimmed', () => {
    expect(extractCity('Brooklyn')).toBe('Brooklyn');
    expect(extractCity('  Austin, TX  ')).toBe('Austin, TX');
  });

  it('reads a { city } object, trimmed', () => {
    expect(extractCity({ city: 'London' })).toBe('London');
    expect(extractCity({ city: '  Paris ' })).toBe('Paris');
  });

  it('returns empty for null / absent / malformed', () => {
    expect(extractCity(null)).toBe('');
    expect(extractCity(undefined)).toBe('');
    expect(extractCity({})).toBe('');
    expect(extractCity({ city: 42 })).toBe('');
    expect(extractCity(42)).toBe('');
    expect(extractCity('   ')).toBe('');
  });
});
