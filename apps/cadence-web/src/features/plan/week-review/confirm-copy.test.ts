import { describe, expect, it } from 'vitest';
import { confirmCopy, confirmReceipt } from './confirm-copy.ts';

describe('confirmCopy', () => {
  it('reads as the plain confirm when nothing changed', () => {
    expect(confirmCopy(0)).toEqual({
      label: 'Confirm my week',
      helper: 'Nothing changed — confirms the week as logged.',
    });
  });

  it('singularizes one fix / one correction', () => {
    expect(confirmCopy(1)).toEqual({
      label: 'Confirm week · save 1 fix',
      helper: '1 correction will be written to your log, then a summary goes to your coach.',
    });
  });

  it('pluralizes several fixes / corrections', () => {
    expect(confirmCopy(3)).toEqual({
      label: 'Confirm week · save 3 fixes',
      helper: '3 corrections will be written to your log, then a summary goes to your coach.',
    });
  });
});

describe('confirmReceipt', () => {
  it('formats the exact receipt string, singular correction', () => {
    const text = confirmReceipt({
      sessions_done: 5,
      sessions_total: 5,
      meals_logged: 20,
      meals_total: 21,
      corrections: 1,
    });
    expect(text).toBe('Week confirmed — 5 of 5 sessions · 20 of 21 meals · 1 correction');
  });

  it('formats the exact receipt string, plural corrections', () => {
    const text = confirmReceipt({
      sessions_done: 5,
      sessions_total: 5,
      meals_logged: 18,
      meals_total: 21,
      corrections: 3,
    });
    expect(text).toBe('Week confirmed — 5 of 5 sessions · 18 of 21 meals · 3 corrections');
  });

  it('formats zero corrections as a plural (0 corrections), not a false singular', () => {
    const text = confirmReceipt({
      sessions_done: 5,
      sessions_total: 5,
      meals_logged: 21,
      meals_total: 21,
      corrections: 0,
    });
    expect(text).toBe('Week confirmed — 5 of 5 sessions · 21 of 21 meals · 0 corrections');
  });
});
