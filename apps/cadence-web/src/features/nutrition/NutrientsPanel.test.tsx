/**
 * The eight micronutrients have flowed end to end since 2026-08-15 with nothing drawing them.
 * These tests hold the drawing to the two things that make it worth having: a ceiling that cannot
 * be mistaken for a goal, and an empty day that cannot be mistaken for a bad one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Meal } from '../../lib/api.ts';
import { NutrientsPanel } from './NutrientsPanel.tsx';

const meal = (over: Partial<Meal> = {}): Meal =>
  ({ log_id: 'm1', date: '2026-08-20', meal: 'lunch', items: [{ name: 'lentil stew' }], ...over }) as Meal;

const TOTALS = {
  kcal: 1310,
  iron_mg: 6,
  zinc_mg: 14,
  vitamin_c_mg: 120,
  calcium_mg: 1300,
  potassium_mg: 3600,
  vitamin_b12_ug: 3,
  fiber_g: 40,
  sodium_mg: 1400,
};

function draw(over: Partial<Parameters<typeof NutrientsPanel>[0]> = {}) {
  return render(
    <NutrientsPanel
      dateLabel="Today"
      dayTotals={TOTALS}
      dayMeals={[meal({ macros: TOTALS })]}
      week={{ avg: null, meals: [], days: 0 }}
      onBack={() => {}}
      onCoach={() => {}}
      {...over}
    />,
  );
}

afterEach(cleanup);

describe('NutrientsPanel', () => {
  it('separates what to reach for from the one thing to stay under', () => {
    const { container } = draw();
    expect(screen.getByText('AIMING TO REACH THESE')).toBeTruthy();
    expect(screen.getByText('STAYING UNDER THIS ONE')).toBeTruthy();
    expect(screen.getByText('STAY UNDER')).toBeTruthy();
    // The two shapes are structurally different, not the same bar recoloured.
    expect(container.querySelector('.nb-floor')).toBeTruthy();
    expect(container.querySelector('.nb-ceil .nb-post')).toBeTruthy();
    expect(container.querySelector('.nb-ceil .nb-tick')).toBeNull();
  });

  it('calls a budget a budget', () => {
    draw();
    expect(screen.getByText(/A budget, not a goal/)).toBeTruthy();
  });

  it('names the label and the number separately for a screen reader', () => {
    draw();
    // Never "Iron6mg" — the label, the amount and the reference intake stay distinct words.
    expect(screen.getByLabelText('Iron: 6 mg of 18')).toBeTruthy();
    expect(screen.getByLabelText('Sodium: 1,400 of a 2,300 mg budget')).toBeTruthy();
  });

  it('counts everything else without remarking on it', () => {
    draw();
    expect(screen.getByText('ALSO COUNTED')).toBeTruthy();
    expect(screen.getByText('Zinc')).toBeTruthy();
  });

  it('says what it could and could not count from', () => {
    draw();
    expect(screen.getByText(/Counted from 1 of your 1 items/)).toBeTruthy();
    expect(screen.getByText(/published adult figures/)).toBeTruthy();
  });

  /** A meal typed in words is not seven deficiencies. */
  it('replaces the lists with a sentence when nothing carried mineral data', () => {
    draw({ dayTotals: { kcal: 800 }, dayMeals: [meal({ macros: { kcal: 800 } })] });
    expect(screen.queryByText('AIMING TO REACH THESE')).toBeNull();
    expect(screen.queryByText('ALSO COUNTED')).toBeNull();
    expect(screen.getByText(/Nothing here can be counted yet/)).toBeTruthy();
  });

  it('says so plainly when the week has nothing finished to average', () => {
    draw();
    fireEvent.click(screen.getByRole('tab', { name: 'This week' }));
    expect(screen.getByText(/no daily average to read/)).toBeTruthy();
  });

  it('hands the coach an app-authored note rather than a bare question', () => {
    const onCoach = vi.fn();
    draw({ onCoach });
    fireEvent.click(screen.getByText('Ask about any of these'));
    expect(onCoach).toHaveBeenCalledWith(expect.stringContaining('floor rather than a measurement'));
  });
});
