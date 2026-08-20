/**
 * The strip has three honest states and must never invent a fourth: scored (a kcal target
 * exists — filled ring, filled bars), counting (food is active, no target — the same smooth ring
 * left unfilled, bare grams, countdown while a goal is earning its target), and nothing at all
 * when food is truly idle. The ring's texture never carries the difference (see
 * `NutritionRing.test.tsx`); `counting` here is a door gate, not a drawing instruction.
 *
 * The door rule is the point (device report 2026-08-15): the strip is the only trail door to the
 * Food home, so it must outlive the score — `has_recent_food` keeps it for a target-less logger,
 * and its absence keeps the bay clean for someone who never logs food.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const useNutritionDay = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({ useNutritionDay: (...a: unknown[]) => useNutritionDay(...a) }));

const { TrailFoodStrip } = await import('./TrailFoodStrip.tsx');

const day = (over: Record<string, unknown>) => ({
  date: '2026-08-18',
  meals: [],
  totals: { kcal: 1240, protein_g: 88, carbs_g: 148, fat_g: 44 },
  provisional_totals: {},
  confirmed_count: 2,
  provisional_count: 0,
  targets: null,
  left: null,
  burn_kcal: 0,
  eatback_kcal: 0,
  eatback_pct: 50,
  targets_wait: null,
  has_recent_food: false,
  ...over,
});

afterEach(cleanup);

describe('TrailFoodStrip', () => {
  it('scores against a target: kcal left in the ring, bars with denominators', () => {
    useNutritionDay.mockReturnValue({
      data: day({ targets: { kcal: 2200, protein_g: 150, carbs_g: 195, fat_g: 65 }, left: { kcal: 960 } }),
    });
    render(<TrailFoodStrip date="2026-08-18" onOpen={() => {}} />);
    expect(screen.getByText('960')).toBeTruthy();
    expect(screen.getByText('LEFT')).toBeTruthy();
    expect(screen.getByText('88 / 150 g')).toBeTruthy();
  });

  it('counts without scoring when meals exist and no target does: bare grams, no denominators', () => {
    useNutritionDay.mockReturnValue({
      data: day({ meals: [{ log_id: 'a' }, { log_id: 'b' }] }),
    });
    render(<TrailFoodStrip date="2026-08-18" onOpen={() => {}} />);
    expect(screen.getByText('1,240')).toBeTruthy();
    expect(screen.getByText('KCAL')).toBeTruthy();
    expect(screen.getByText('88')).toBeTruthy(); // grams, no " / 150 g"
    expect(screen.queryByText(/\/ .*g/)).toBeNull();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('MEALS')).toBeTruthy();
  });

  it('keeps the countdown while the target is still being earned', () => {
    useNutritionDay.mockReturnValue({ data: day({ targets_wait: { days_logged: 3, days_needed: 7 } }) });
    render(<TrailFoodStrip date="2026-08-18" onOpen={() => {}} />);
    expect(screen.getByText('3 / 7')).toBeTruthy();
    expect(screen.getByText(/DAYS TO YOUR CALORIE TARGET/)).toBeTruthy();
  });

  /** The strip is a door too — logging is what moves the countdown, and the home is where you log. */
  it('opens the Food home from the countdown state', () => {
    const onOpen = vi.fn();
    useNutritionDay.mockReturnValue({ data: day({ targets_wait: { days_logged: 1, days_needed: 7 } }) });
    render(<TrailFoodStrip date="2026-08-18" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  /** The door outlives the score: an old log keeps the strip even with nothing eaten today. */
  it('stays for a target-less logger with only has_recent_food', () => {
    useNutritionDay.mockReturnValue({ data: day({ totals: {}, has_recent_food: true }) });
    render(<TrailFoodStrip date="2026-08-18" onOpen={() => {}} />);
    expect(screen.getAllByText('0').length).toBeGreaterThan(0); // ring centre and bare bars all read 0
    expect(screen.getByText('KCAL')).toBeTruthy();
  });

  it('renders nothing for someone not tracking at all', () => {
    useNutritionDay.mockReturnValue({ data: day({}) });
    const { container } = render(<TrailFoodStrip date="2026-08-18" onOpen={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while the day is still loading', () => {
    useNutritionDay.mockReturnValue({ data: null });
    const { container } = render(<TrailFoodStrip date="2026-08-18" onOpen={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  /** A real target beats a stale wait — the scored strip, never both. */
  it('prefers the scored strip when both a target and a leftover wait exist', () => {
    useNutritionDay.mockReturnValue({
      data: day({ targets: { kcal: 2000 }, targets_wait: { days_logged: 7, days_needed: 7 } }),
    });
    render(<TrailFoodStrip date="2026-08-18" onOpen={() => {}} />);
    expect(screen.getByText('LEFT')).toBeTruthy();
    expect(screen.queryByText(/DAYS TO YOUR/)).toBeNull();
  });
});
