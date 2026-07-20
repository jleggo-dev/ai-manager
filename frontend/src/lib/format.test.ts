import { describe, it, expect } from 'vitest';
import { formatTimestamp, formatTimestampShort } from './format';

describe('formatTimestamp', () => {
  it('returns locale string for valid ISO', () => {
    const out = formatTimestamp('2024-06-15T12:30:00.000Z');
    expect(out).not.toBe('2024-06-15T12:30:00.000Z');
    expect(out.length).toBeGreaterThan(0);
  });

  it('returns original string for invalid input', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('formatTimestampShort', () => {
  it('includes month abbreviation for a fixed ISO', () => {
    const out = formatTimestampShort('2024-06-15T12:30:45.000Z');
    expect(out).toMatch(/Jun/);
  });
});
