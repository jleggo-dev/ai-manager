import { describe, expect, it } from 'vitest';
import { formatCaptionNumber, flatFields, renderCaption } from './caption.ts';

describe('formatCaptionNumber', () => {
  it('drops decimals for whole numbers', () => {
    expect(formatCaptionNumber(172)).toBe('172');
    expect(formatCaptionNumber(0)).toBe('0');
  });

  it('keeps one decimal for fractional numbers, rounding sensibly', () => {
    expect(formatCaptionNumber(172.4)).toBe('172.4');
    expect(formatCaptionNumber(0.34)).toBe('0.3');
    expect(formatCaptionNumber(-1.27)).toBe('-1.3');
  });

  it('returns empty for non-finite input rather than "NaN" or "Infinity"', () => {
    expect(formatCaptionNumber(NaN)).toBe('');
    expect(formatCaptionNumber(Infinity)).toBe('');
  });
});

describe('flatFields', () => {
  it('keeps primitive top-level fields, including null and zero/false', () => {
    expect(flatFields({ a: 1, b: 'x', c: true, d: null, e: 0, f: false })).toEqual({
      a: 1,
      b: 'x',
      c: true,
      d: null,
      e: 0,
      f: false,
    });
  });

  it('drops arrays and nested objects — a caption never describes a series', () => {
    expect(flatFields({ series: [1, 2, 3], nested: { x: 1 }, kept: 4 })).toEqual({ kept: 4 });
  });
});

describe('renderCaption', () => {
  it('interpolates {field} placeholders from flat fields', () => {
    expect(renderCaption('{kept} of {scheduled} this week', { kept: 4, scheduled: 5 })).toBe('4 of 5 this week');
  });

  it('formats interpolated numbers sensibly', () => {
    expect(renderCaption('easing {direction} about {rate} a week', { direction: 'down', rate: 0.34 })).toBe(
      'easing down about 0.3 a week',
    );
  });

  it('renders an unresolved or null placeholder as empty, never as literal {field} text', () => {
    expect(renderCaption('trend: {trend}', {})).toBe('trend: ');
    expect(renderCaption('trend: {trend}', { trend: null })).toBe('trend: ');
  });

  it('leaves the template untouched when it has no placeholders', () => {
    expect(renderCaption('early days — the line firms up as readings accumulate', { anything: 1 })).toBe(
      'early days — the line firms up as readings accumulate',
    );
  });
});
