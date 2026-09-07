/**
 * The future-task preview: a look, never a start. It shows what is coming by task shape, and its
 * one door leads to the "do it now" ask — absent on a row that is already done.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PlanDay, PlanOccurrence } from '../../../lib/api.ts';

const getOccurrenceDetail = vi.fn();
vi.mock('../../../lib/api.ts', () => ({ getOccurrenceDetail: (...a: unknown[]) => getOccurrenceDetail(...a) }));
const planned = vi.hoisted(() => ({ meal: null as { name: string } | null }));
vi.mock('../occurrence/usePlannedMeal.ts', () => ({
  usePlannedMeal: () => ({ planned: planned.meal, alsoThisWeek: [] }),
}));
vi.mock('../../../lib/query/index.ts', () => ({ useClockUnit: () => '24h' }));

const { PreviewSheet } = await import('./PreviewSheet.tsx');

const TODAY = '2026-09-07';
const WEEK: PlanDay[] = [
  { date: '2026-09-07', weekday: 'Mon', dayNum: 7, isToday: true, occurrences: [] },
  { date: '2026-09-09', weekday: 'Wed', dayNum: 9, isToday: false, occurrences: [] },
];
const occ = (over: Partial<PlanOccurrence> = {}): PlanOccurrence => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  title: 'Easy run',
  kind: 'user',
  status: 'pending',
  time_of_day: '07:30',
  ...over,
});

function mount(o: PlanOccurrence, onDoNow?: () => void) {
  const onClose = vi.fn();
  render(<PreviewSheet occ={o} date="2026-09-09" todayIso={TODAY} week={WEEK} onClose={onClose} onDoNow={onDoNow} />);
  return { onClose };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  planned.meal = null;
});

describe('PreviewSheet', () => {
  it('a session: the day, the time, then the steps as written — and no Start', async () => {
    getOccurrenceDetail.mockResolvedValue({
      occurrence_id: 'o1',
      title: 'Easy run',
      status: 'pending',
      date: '2026-09-09',
      session: {
        blocks: [
          {
            label: 'Main',
            items: [
              { name: 'Jog', duration_min: 20 },
              { name: 'Strides', duration_min: 5 },
            ],
          },
        ],
        note: '',
        generated_at: '',
        version: 1,
      },
    });
    const onDoNow = vi.fn();
    mount(occ(), onDoNow);
    expect(screen.getByText('Sketching this one out…')).toBeTruthy();
    expect(await screen.findByText('Jog')).toBeTruthy();
    expect(screen.getByText('Strides')).toBeTruthy();
    expect(screen.getByText(/Wed 9 · at 07:30/)).toBeTruthy();
    expect(screen.queryByText(/I've got time/)).toBeNull();
    fireEvent.click(screen.getByText('Do it now?'));
    expect(onDoNow).toHaveBeenCalledTimes(1);
  });

  it('a session not yet written says so, honestly', async () => {
    getOccurrenceDetail.mockResolvedValue({ occurrence_id: 'o1', title: 'Easy run', status: 'pending', session: null });
    mount(occ());
    expect(await screen.findByText(/write this one up closer to the day/)).toBeTruthy();
  });

  it('a row a replan removed says so', async () => {
    getOccurrenceDetail.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    mount(occ());
    expect(await screen.findByText(/moved with your new plan/)).toBeTruthy();
  });

  it("a meal shows what's on the menu — and never asks the server for a session", () => {
    planned.meal = { name: 'Lentil soup' };
    mount(occ({ title: 'Log lunch', kind: 'system' }));
    expect(screen.getByText('On the menu: Lentil soup.')).toBeTruthy();
    expect(getOccurrenceDetail).not.toHaveBeenCalled();
  });

  it('a meal with nothing planned says nothing is planned', () => {
    mount(occ({ title: 'Log dinner', kind: 'system' }));
    expect(screen.getByText('Nothing on the menu for this one yet.')).toBeTruthy();
  });

  it('a weigh-in is one line', () => {
    mount(occ({ title: 'Weigh-in', kind: 'system' }));
    expect(screen.getByText(/step on the scale/)).toBeTruthy();
  });

  it('with no door offered (a done row), only "Not yet" remains', () => {
    getOccurrenceDetail.mockResolvedValue({ occurrence_id: 'o1', title: 'Easy run', status: 'done', session: null });
    const { onClose } = mount(occ({ status: 'done' }));
    expect(screen.queryByText('Do it now?')).toBeNull();
    fireEvent.click(screen.getByText('Not yet'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
