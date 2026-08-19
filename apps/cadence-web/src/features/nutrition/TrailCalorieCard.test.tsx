/**
 * The card has three honest states and must never invent a fourth: a ring with numbers when a
 * target exists, a countdown while the target is being EARNED (7 logged days before the baseline
 * flow proposes one), and nothing at all for someone not tracking. The countdown exists because
 * the wait used to be invisible — a committed "Lose weight" with no target, no explanation, no
 * path (owner, 2026-08-18).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const useNutritionDay = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({ useNutritionDay: (...a: unknown[]) => useNutritionDay(...a) }));

const { TrailCalorieCard } = await import('./TrailCalorieCard.tsx');

const day = (over: Record<string, unknown>) => ({
  date: '2026-08-18',
  meals: [],
  totals: { kcal: 1240 },
  provisional_totals: {},
  confirmed_count: 2,
  provisional_count: 0,
  targets: null,
  left: null,
  burn_kcal: 0,
  eatback_kcal: 0,
  eatback_pct: 50,
  targets_wait: null,
  ...over,
});

afterEach(cleanup);

describe('TrailCalorieCard', () => {
  it('shows the ring numbers when a target exists', () => {
    useNutritionDay.mockReturnValue({ data: day({ targets: { kcal: 2200 } }) });
    render(<TrailCalorieCard date="2026-08-18" onOpen={() => {}} />);
    expect(screen.getByText(/1,?240 \/ 2,?200/)).toBeTruthy();
    expect(screen.getByText('CALORIES')).toBeTruthy();
  });

  it('shows the countdown while the target is still being earned', () => {
    useNutritionDay.mockReturnValue({ data: day({ targets_wait: { days_logged: 3, days_needed: 7 } }) });
    render(<TrailCalorieCard date="2026-08-18" onOpen={() => {}} />);
    expect(screen.getByText('3 / 7')).toBeTruthy();
    expect(screen.getByText(/DAYS TO YOUR CALORIE TARGET/)).toBeTruthy();
  });

  /** The countdown is a door too — logging meals is what moves it, and the sheet is where you log. */
  it('opens the food sheet from the countdown', () => {
    const onOpen = vi.fn();
    useNutritionDay.mockReturnValue({ data: day({ targets_wait: { days_logged: 1, days_needed: 7 } }) });
    render(<TrailCalorieCard date="2026-08-18" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for someone not tracking at all', () => {
    useNutritionDay.mockReturnValue({ data: day({}) });
    const { container } = render(<TrailCalorieCard date="2026-08-18" onOpen={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while the day is still loading', () => {
    useNutritionDay.mockReturnValue({ data: null });
    const { container } = render(<TrailCalorieCard date="2026-08-18" onOpen={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  /** A real target beats a stale wait — the ring, never both. */
  it('prefers the ring when both a target and a leftover wait exist', () => {
    useNutritionDay.mockReturnValue({
      data: day({ targets: { kcal: 2000 }, targets_wait: { days_logged: 7, days_needed: 7 } }),
    });
    render(<TrailCalorieCard date="2026-08-18" onOpen={() => {}} />);
    expect(screen.getByText('CALORIES')).toBeTruthy();
    expect(screen.queryByText(/DAYS TO YOUR/)).toBeNull();
  });
});
