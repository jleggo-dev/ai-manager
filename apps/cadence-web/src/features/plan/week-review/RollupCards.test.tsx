import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RhythmWeek } from '@cadence/shared';
import type { WeekReviewFacts } from '../../../lib/api.ts';
import { RollupCards } from './RollupCards.tsx';

/**
 * SESSIONS reads `facts.rhythm_week` straight from the server now (Progress Engine parcel W2-2 —
 * RollupCards.tsx no longer counts session occurrences itself), so a fixture needs one. This
 * mirrors the server's own `buildSessionsRhythmWeek` (week-review-widgets.ts) just enough for a
 * test double: one state per day, "kept" when any session that day is done.
 */
function rhythmWeekFromDays(days: WeekReviewFacts['days']): RhythmWeek {
  const doneDays = new Set(days.filter((d) => d.sessions.some((s) => s.status === 'done')).map((d) => d.date));
  const scheduledDays = new Set(days.filter((d) => d.sessions.length > 0).map((d) => d.date));
  return {
    start: days[0]?.date ?? '2026-08-17',
    label: 'Aug 17–23',
    days: days.map((d) => ({
      date: d.date,
      state: doneDays.has(d.date) ? 'kept' : scheduledDays.has(d.date) ? 'missed' : 'unscheduled',
    })),
    kept: doneDays.size,
    scheduled: scheduledDays.size,
    detour: null,
  };
}

function facts(over: Partial<WeekReviewFacts['days'][number]>[] = []): WeekReviewFacts {
  const days = over.map((d, i) => ({
    date: `2026-08-${17 + i}`,
    sessions: [],
    meals: [
      { meal: 'breakfast' as const, occurrence_id: null, logged: false },
      { meal: 'lunch' as const, occurrence_id: null, logged: false },
      { meal: 'dinner' as const, occurrence_id: null, logged: false },
    ],
    mind: [],
    ...d,
  }));
  return {
    period: { from: '2026-08-17', to: '2026-08-23' },
    weigh_in: null,
    days,
    rhythm_week: rhythmWeekFromDays(days),
  };
}

describe('RollupCards', () => {
  it('renders MEALS as kept/total, "17 of 21" style, and SESSIONS through the shared rhythm widget', () => {
    const week = facts(
      Array.from({ length: 7 }, (_, i) => ({
        meals: [
          { meal: 'breakfast' as const, occurrence_id: `b${i}`, logged: i < 6 },
          { meal: 'lunch' as const, occurrence_id: `l${i}`, logged: i < 6 },
          { meal: 'dinner' as const, occurrence_id: `d${i}`, logged: i < 5 },
        ],
        // 5 of the 7 days schedule one session; 3 of those 5 are done — kept 3, scheduled 5.
        sessions:
          i < 5
            ? [{ occurrence_id: `s${i}`, title: 'Easy run', status: i < 3 ? ('done' as const) : ('missed' as const) }]
            : [],
      })),
    );
    render(<RollupCards facts={week} />);

    expect(screen.getByText('MEALS')).toBeInTheDocument();
    expect(screen.getByText('17/21')).toBeInTheDocument();
    // SESSIONS: the shared rhythm widget's own shell + caption format ("Sessions" title, "3 of 5"
    // — not RollupCard's bespoke "SESSIONS"/"3/5" — see RollupCards.tsx's doc for why).
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('3 of 5')).toBeInTheDocument();
  });

  it('omits the SESSIONS widget entirely for a week with nothing scheduled', () => {
    const week = facts([{}, {}]);
    render(<RollupCards facts={week} />);
    expect(screen.queryByText('Sessions')).not.toBeInTheDocument();
  });

  it('omits the MINDSET card entirely for a week with no mind/practice rows', () => {
    const week = facts([{}, {}]);
    render(<RollupCards facts={week} />);
    expect(screen.queryByText('MINDSET')).not.toBeInTheDocument();
  });

  it('shows MINDSET once the week has any mind/practice rows', () => {
    const week = facts([
      { mind: [{ occurrence_id: 'g1', title: 'Sit', status: 'done', done: true }] },
      { mind: [{ occurrence_id: 'g2', title: 'Sit', status: 'pending', done: false }] },
    ]);
    render(<RollupCards facts={week} />);
    expect(screen.getByText('MINDSET')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });
});
