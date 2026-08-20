/**
 * The Week tab, drawn. The frame's caption is the acceptance criterion: "days not yet lived read
 * 'not yet' rather than zero — a blank day is not a bad day."
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Meal } from '../../lib/api.ts';
import { FoodWeek } from './FoodWeek.tsx';

const WED = '2026-09-02';
const meal = (date: string, macros: Record<string, number>): Meal =>
  ({ log_id: `m-${date}`, date, meal: 'lunch', items: [], macros }) as Meal;

const MEALS = [
  meal('2026-08-31', { kcal: 1880, protein_g: 148 }),
  meal('2026-09-01', { kcal: 1910, protein_g: 151 }),
  meal(WED, { kcal: 1240, protein_g: 88 }),
];

afterEach(cleanup);

describe('FoodWeek', () => {
  it('reads "not yet" for the days ahead and never a zero', () => {
    render(<FoodWeek today={WED} meals={MEALS} targets={{ kcal: 1940 }} />);
    expect(screen.getAllByText('not yet').length).toBe(4); // Thu–Sun
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByLabelText('Thu 3 Sep — not yet')).toBeTruthy();
  });

  it('shows the average against the target, made only of the days behind you', () => {
    render(<FoodWeek today={WED} meals={MEALS} targets={{ kcal: 1940, protein_g: 150 }} />);
    expect(screen.getByText('1,895')).toBeTruthy();
    expect(screen.getByText('KCAL AVG')).toBeTruthy();
    expect(screen.getByText(/averages across the 2 days behind you · target 1,940/)).toBeTruthy();
  });

  it('says today is still going rather than averaging half a day', () => {
    render(<FoodWeek today={WED} meals={[meal(WED, { kcal: 900 })]} targets={null} />);
    expect(screen.getByText('NOT YET')).toBeTruthy();
    expect(screen.getByText(/today is still going/)).toBeTruthy();
  });

  it('opens a lived day but leaves an unlived one alone', () => {
    const onOpenDay = vi.fn();
    render(<FoodWeek today={WED} meals={MEALS} targets={null} onOpenDay={onOpenDay} />);
    fireEvent.click(screen.getByLabelText('Mon 31 Aug — 1,880 kcal'));
    expect(onOpenDay).toHaveBeenCalledWith('2026-08-31');

    fireEvent.click(screen.getByLabelText('Sat 5 Sep — not yet'));
    expect(onOpenDay).toHaveBeenCalledTimes(1); // a day that has not happened is not a door
  });
});
