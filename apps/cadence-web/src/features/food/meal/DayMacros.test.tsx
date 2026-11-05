/**
 * The day at the top of the drawer. A day not read yet must never look like a day with nothing in
 * it: "0 SO FAR" sat over a day with breakfast logged (owner, 2026-11-04 screenshot).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { NutritionDayData } from '../../../lib/api.ts';
import { DayMacros, UNKNOWN } from './DayMacros.tsx';

const day = (over: Partial<NutritionDayData> = {}) =>
  ({
    date: '2026-11-04',
    meals: [],
    totals: { kcal: 584, protein_g: 40, carbs_g: 50, fat_g: 20 },
    targets: { kcal: 2000, protein_g: 160, carbs_g: 220, fat_g: 70 },
    ...over,
  }) as unknown as NutritionDayData;

afterEach(cleanup);

describe('DayMacros', () => {
  it.each([
    ['still on its way', undefined],
    ['the read failed', null],
  ])('%s: dashes, and no zero anywhere', (_, value) => {
    const { container } = render(<DayMacros day={value} cart={{}} />);
    expect(screen.getByLabelText('Your day is still loading')).toHaveTextContent(UNKNOWN);
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toContain('SO FAR');
  });

  it('a read day with targets says what is left', () => {
    const { container } = render(<DayMacros day={day()} cart={{}} />);
    expect(container.textContent).toContain('LEFT');
    expect(container.textContent).toContain('40 / 160');
  });

  it('near-miss: a read day with no targets and nothing logged really is zero so far', () => {
    const { container } = render(<DayMacros day={day({ targets: null, totals: {} })} cart={{}} />);
    expect(container.textContent).toContain('SO FAR');
    expect(container.textContent).toContain('0g');
  });
});
