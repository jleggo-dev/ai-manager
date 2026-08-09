import { describe, expect, it } from 'vitest';
import {
  CHECKIN_ADJUSTMENT_OPTIONS,
  FELT_STATE_CHIPS,
  FELT_STATE_CODES,
  MOODS,
  RPE_CHIPS,
  RPE_CODES,
  SKIP_REASON_CHIPS,
  SKIP_REASON_CODES,
} from './session-feedback.ts';

describe('session feedback vocabulary', () => {
  it('keeps every chip set aligned with its code list', () => {
    // Drift here is the failure the DB CHECK would otherwise catch at 500: a chip whose code was
    // never added to the enum renders fine and fails only on write.
    expect(RPE_CHIPS.map((c) => c.code)).toEqual([...RPE_CODES]);
    expect(SKIP_REASON_CHIPS.map((c) => c.code)).toEqual([...SKIP_REASON_CODES]);
    expect(FELT_STATE_CHIPS.map((c) => c.code)).toEqual([...FELT_STATE_CODES]);
  });

  it('gives every answer a reply — an answer that changes nothing is not worth asking for', () => {
    for (const chip of [...RPE_CHIPS, ...SKIP_REASON_CHIPS, ...FELT_STATE_CHIPS]) {
      expect(chip.reply.trim().length).toBeGreaterThan(0);
      expect(chip.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('never shames a stop — no reply frames stopping as a failure', () => {
    const banned = /\bfail|excuse|should have|lazy|only\b/i;
    for (const chip of [...SKIP_REASON_CHIPS, ...FELT_STATE_CHIPS]) {
      expect(chip.reply).not.toMatch(banned);
    }
  });

  it('offers a 5-point mood scale with contiguous values', () => {
    expect(MOODS.map((m) => m.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it('makes "keep as is" the only adjustment that does not open a preview', () => {
    // The other two carry a steer, and a steer means the ordinary suggest→preview→confirm flow.
    // Nothing in the check-in may move a plan without showing it first.
    const keep = CHECKIN_ADJUSTMENT_OPTIONS.find((o) => o.code === 'keep');
    expect(keep?.steer).toBe('');
    for (const opt of CHECKIN_ADJUSTMENT_OPTIONS.filter((o) => o.code !== 'keep')) {
      expect(opt.steer.trim().length).toBeGreaterThan(0);
    }
  });
});
