/**
 * The owner gave his weight in pounds, was told it back in kilos, and got coached in metric from
 * then on (2026-08-22). Storage is canonical kg and always will be; `baseline.weight_unit` records
 * what he SAID, and every display path has to convert back. This is the one place that does it.
 */
import { describe, it, expect } from 'vitest';
import { displayWeightUnit, formatWeight, LB_PER_KG } from './weight-units.ts';

describe('displayWeightUnit', () => {
  /** Both spellings are in the data: weigh-in.ts writes 'lbs', older rows carry 'lb'. */
  it.each(['lb', 'lbs', 'LB', ' Lbs '])('reads %s as pounds', (stored) => {
    expect(displayWeightUnit(stored)).toBe('lb');
  });

  it.each(['kg', 'KG', undefined, null, '', 'stone', 42])('falls back to kg for %s', (stored) => {
    expect(displayWeightUnit(stored)).toBe('kg');
  });
});

describe('formatWeight', () => {
  it('leaves kg alone', () => {
    expect(formatWeight(88.5, 'kg')).toBe('88.5kg');
  });

  it('converts to pounds for someone who thinks in pounds', () => {
    // 88.5kg is a shade over 195lb.
    expect(formatWeight(88.5, 'lb')).toBe('195.1lb');
  });

  /**
   * One decimal, deliberately. A bodyweight is measured to about that, and "195.10382lb" is a
   * false precision that invites arguing with the scale.
   */
  it('does not report a precision nobody measured', () => {
    expect(formatWeight(88.5, 'lb')).not.toMatch(/\d\.\d\d/);
    expect(formatWeight(80, 'kg')).toBe('80kg');
  });

  it('round-trips within a tenth', () => {
    const kg = 73.4;
    const lb = kg * LB_PER_KG;
    expect(Math.abs(lb / LB_PER_KG - kg)).toBeLessThan(0.1);
  });
});
