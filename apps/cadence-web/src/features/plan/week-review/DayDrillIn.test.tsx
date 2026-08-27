import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WeekReviewDay } from '../../../lib/api.ts';
import { DayDrillIn } from './DayDrillIn.tsx';

function renderDay(
  day: WeekReviewDay,
  overrides: Partial<Record<'onToggleSession' | 'onToggleMeal' | 'onToggleMindStep' | 'onBack', unknown>> = {},
) {
  const onToggleSession = vi.fn();
  const onToggleMeal = vi.fn();
  const onToggleMindStep = vi.fn();
  const onBack = vi.fn();
  render(
    <DayDrillIn
      day={day}
      onBack={(overrides.onBack as typeof onBack) ?? onBack}
      onToggleSession={(overrides.onToggleSession as typeof onToggleSession) ?? onToggleSession}
      onToggleMeal={(overrides.onToggleMeal as typeof onToggleMeal) ?? onToggleMeal}
      onToggleMindStep={(overrides.onToggleMindStep as typeof onToggleMindStep) ?? onToggleMindStep}
    />,
  );
  return { onToggleSession, onToggleMeal, onToggleMindStep, onBack };
}

describe('DayDrillIn', () => {
  it('renders sessions, meals and named mind steps for the day, all LIVE', () => {
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [{ occurrence_id: 's1', title: 'Easy run', status: 'done', planned_min: 40, logged_min: 45 }],
      meals: [
        { meal: 'breakfast', occurrence_id: 'm1', logged: true },
        { meal: 'lunch', occurrence_id: 'm2', logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [
        {
          occurrence_id: 'g1',
          title: 'Evening pages',
          status: 'pending',
          steps: [
            { name: 'Settle', done: true },
            { name: 'Write', done: false },
          ],
        },
      ],
    };
    renderDay(day);

    expect(screen.getByText('Easy run')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument(); // the stepper's own current value
    expect(screen.getByText('Breakfast')).toBeInTheDocument();
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.getByText('Dinner')).toBeInTheDocument();
    expect(screen.getByText('Evening pages')).toBeInTheDocument();
    expect(screen.getByText('Settle')).toBeInTheDocument();
    expect(screen.getByText('Write')).toBeInTheDocument();

    // Live this step: every checkbox present and enabled, except the meal with no occurrence.
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    const enabled = boxes.filter((b) => !(b as HTMLInputElement).disabled);
    expect(enabled.length).toBe(boxes.length - 1); // only the null-occurrence dinner slot is disabled
  });

  it('a mind row with no named steps falls back to a single done/not-done row, wired to the session toggle', () => {
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [{ occurrence_id: 'g1', title: 'Sit', status: 'done', done: true }],
    };
    const { onToggleSession } = renderDay(day);
    expect(screen.getByText('Sit')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(4); // 3 meals + the one mind row

    screen.getByLabelText('Sit').click();
    expect(onToggleSession).toHaveBeenCalledWith('g1', false); // it was done — the click un-checks it
  });

  it('checking a session confirms it done', () => {
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [{ occurrence_id: 's1', title: 'Easy run', status: 'pending' }],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [],
    };
    const { onToggleSession } = renderDay(day);
    screen.getByLabelText('Easy run').click();
    expect(onToggleSession).toHaveBeenCalledWith('s1', true);
  });

  it('the minutes stepper reports its new value AND confirms done, since minutes only persist on a done row', () => {
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [{ occurrence_id: 's1', title: 'Easy run', status: 'pending', planned_min: 30 }],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [],
    };
    const { onToggleSession } = renderDay(day);
    screen.getByLabelText('More minutes').click();
    expect(onToggleSession).toHaveBeenCalledWith('s1', true, 31);
  });

  it('flipping a meal slot reports the day, the meal, and the new state', () => {
    const day: WeekReviewDay = {
      date: '2026-08-19',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: 'b1', logged: false },
        { meal: 'lunch', occurrence_id: 'l1', logged: true },
        { meal: 'dinner', occurrence_id: 'd1', logged: false },
      ],
      mind: [],
    };
    const { onToggleMeal } = renderDay(day);
    screen.getByLabelText('Breakfast').click();
    expect(onToggleMeal).toHaveBeenCalledWith('2026-08-19', 'breakfast', true);

    screen.getByLabelText('Lunch').click();
    expect(onToggleMeal).toHaveBeenCalledWith('2026-08-19', 'lunch', false);
  });

  it('a meal slot with no occurrence stays disabled — there is nothing there to toggle', () => {
    const day: WeekReviewDay = {
      date: '2026-08-19',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: 'l1', logged: false },
        { meal: 'dinner', occurrence_id: 'd1', logged: false },
      ],
      mind: [],
    };
    renderDay(day);
    expect(screen.getByLabelText('Breakfast')).toBeDisabled();
  });

  it('flipping a named mind step reports the occurrence, the step name, and the new state', () => {
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [
        {
          occurrence_id: 'g1',
          title: 'Evening pages',
          status: 'pending',
          steps: [{ name: 'Settle', done: false }],
        },
      ],
    };
    const { onToggleMindStep } = renderDay(day);
    screen.getByLabelText('Settle').click();
    expect(onToggleMindStep).toHaveBeenCalledWith('g1', 'Settle', true);
  });

  it('shows a plain empty message for a day with nothing scheduled', () => {
    const day: WeekReviewDay = {
      date: '2026-08-24',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [],
    };
    renderDay(day);
    expect(screen.getByText('Nothing scheduled this day.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('the back control reports back to the caller', () => {
    const day: WeekReviewDay = {
      date: '2026-08-17',
      sessions: [],
      meals: [
        { meal: 'breakfast', occurrence_id: null, logged: false },
        { meal: 'lunch', occurrence_id: null, logged: false },
        { meal: 'dinner', occurrence_id: null, logged: false },
      ],
      mind: [],
    };
    const { onBack } = renderDay(day);
    screen.getByText('← Back to the week').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
