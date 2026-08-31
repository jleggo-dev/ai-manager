import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HorizonEndCap } from './HorizonEndCap.tsx';
import { endPhrase } from './end-phrase.ts';

/**
 * The phrase is the part a wrong offset would turn into a lie — "check-in on Saturday" when the
 * flag flips Sunday. `endsOn` is the DUE date (plan-view.ts), so the phrase names THAT day.
 */
describe('endPhrase — when the week wraps, as a person would say it', () => {
  const today = '2026-08-31'; // a Monday
  it('names the due day itself "today"', () => {
    expect(endPhrase('2026-08-31', today)).toBe('today');
    // Past-due reads as today too — the end-of-trail card owns anything staler.
    expect(endPhrase('2026-08-30', today)).toBe('today');
  });
  it('and one day out "tomorrow"', () => {
    expect(endPhrase('2026-09-01', today)).toBe('tomorrow');
  });
  it('a bare weekday within the week', () => {
    expect(endPhrase('2026-09-05', today)).toBe('on Saturday');
  });
  it('weekday + date further out, so an extended week cannot mean two Saturdays', () => {
    expect(endPhrase('2026-09-12', today)).toBe('on Saturday, Sep 12');
  });
  it('null for nothing and for garbage — no sentence beats a wrong one', () => {
    expect(endPhrase(undefined, today)).toBeNull();
    expect(endPhrase('soon', today)).toBeNull();
  });
});

describe('HorizonEndCap', () => {
  it('names the check-in and carries the visible two-weeks ask', () => {
    const onPlanAhead = vi.fn();
    render(<HorizonEndCap endsOn="2026-12-31" canAskAhead onPlanAhead={onPlanAhead} />);
    expect(screen.getByText(/weekly check-in/)).toBeTruthy();
    screen.getByText('Can we plan two weeks ahead?').click();
    expect(onPlanAhead).toHaveBeenCalledTimes(1);
  });

  it('drops the ask once the week already runs long — it would only earn "it already does"', () => {
    render(<HorizonEndCap endsOn="2026-12-31" canAskAhead={false} onPlanAhead={vi.fn()} />);
    expect(screen.getByText(/weekly check-in/)).toBeTruthy();
    expect(screen.queryByText('Can we plan two weeks ahead?')).toBeNull();
  });

  it('renders nothing without a usable end date', () => {
    const { container } = render(<HorizonEndCap canAskAhead onPlanAhead={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
