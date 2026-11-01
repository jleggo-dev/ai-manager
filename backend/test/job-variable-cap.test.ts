/**
 * The engine's cap on one job variable (job-execution-utils.ts, MAX_VARIABLE_LENGTH): a value at
 * the cap is read whole; one character over is cut with a marker AND logged with the variable's
 * name. The food-check job's candidate book was cut at the old 10,000 on every meal of five or
 * more parts with nothing in the logs; this pins that a cut is never quiet, and that the cap is
 * the 40,000 the callers size against.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { interpolateTemplate, MAX_VARIABLE_LENGTH } from '../src/ai-manager/job-execution-utils.ts';

afterEach(() => vi.restoreAllMocks());

describe('MAX_VARIABLE_LENGTH', () => {
  it('is 40,000 — about 10,000 tokens, a runaway guard and not a sizing tool', () => {
    expect(MAX_VARIABLE_LENGTH).toBe(40_000);
  });

  it('a value exactly at the cap is read whole, wrapped, and nothing is logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = 'b'.repeat(MAX_VARIABLE_LENGTH);
    const out = interpolateTemplate('<book>{{book}}</book>', { book: value });
    expect(out).toBe(`<book><user_input name="book">${value}</user_input></book>`);
    expect(warn).not.toHaveBeenCalled();
  });

  it('one character over is cut with the marker and logged with the variable name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = 'b'.repeat(MAX_VARIABLE_LENGTH + 1);
    const out = interpolateTemplate('{{book}}', { book: value });
    expect(out).toBe(`<user_input name="book">${'b'.repeat(MAX_VARIABLE_LENGTH)}... [truncated]</user_input>`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toEqual({
      variable: 'book',
      length: MAX_VARIABLE_LENGTH + 1,
      cap: MAX_VARIABLE_LENGTH,
    });
  });

  it('a short variable beside a cut one is untouched', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = interpolateTemplate('{{a}} {{b}}', { a: 'x'.repeat(MAX_VARIABLE_LENGTH + 5), b: 'short' });
    expect(out.endsWith('<user_input name="b">short</user_input>')).toBe(true);
    expect(out).toContain('... [truncated]</user_input> ');
  });
});
