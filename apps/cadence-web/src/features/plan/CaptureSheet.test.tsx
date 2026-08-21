/**
 * PERF-06 — the meal capture sheet paints before its fetch lands.
 *
 * The owner's report, on device, 2026-08-20: *"I click Log breakfast, I get the 3 loading dots.
 * You know, we shouldn't show this. I think we're probably loading the data? Show the Log
 * breakfast screen, show everything at 0 and then update."*
 *
 * Measured the same day against the deployed API, that wait is **136–163ms of Postgres** — the row
 * is `kind: 'system'`, so `getOccurrenceDetail`'s generate gate is false and no model is involved
 * anywhere in it. The typing dots were the coach's thinking animation, shown over a database read.
 *
 * What these pin is the fix and the honesty constraint together: the header is REAL immediately
 * (the trail already knew the title), the body is a skeleton rather than the dots, and the
 * skeleton draws no numbers — because a placeholder "0 kcal" and a true "0 kcal" are the same
 * pixels, and only one of them is an answer.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const getOccurrenceDetail = vi.fn();
vi.mock('../../lib/api.ts', () => ({ getOccurrenceDetail: (...a: unknown[]) => getOccurrenceDetail(...a) }));

// The loaded panels own their own fetches and tests; stubs keep this about the wait.
vi.mock('./occurrence/MealCapturePanel.tsx', () => ({ MealCapturePanel: () => <div>meal-panel</div> }));
vi.mock('./occurrence/WeighInPanel.tsx', () => ({ WeighInPanel: () => <div>weigh-panel</div> }));

const { CaptureSheet } = await import('./CaptureSheet.tsx');

const detail = (over: Record<string, unknown> = {}) => ({
  occurrence_id: 'o1',
  title: 'Log breakfast',
  kind: 'system',
  status: 'pending',
  date: '2026-08-20',
  category: 'nutrition',
  schedule: { time_of_day: 'morning' },
  ...over,
});

/** A fetch that never settles — the frame the owner was complaining about. */
const hang = () => new Promise<never>(() => {});

function mount(props: Record<string, unknown> = {}) {
  return render(
    <CaptureSheet
      occurrenceId="o1"
      known={{ title: 'Log breakfast', time_of_day: 'morning' }}
      onClose={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CaptureSheet — structure first, numbers after', () => {
  it('shows the tapped row’s own title while the detail fetch is still in flight', () => {
    getOccurrenceDetail.mockImplementation(hang);
    mount();
    // The words were on the phone the whole time; they must not wait for a round trip.
    expect(screen.getByText('Log breakfast')).toBeTruthy();
    expect(screen.getByText(/CAPTURE · NOTHING COUNTS UNTIL YOU CONFIRM/)).toBeTruthy();
  });

  it('never shows the coach’s typing dots over a deterministic read', () => {
    getOccurrenceDetail.mockImplementation(hang);
    const { container } = mount();
    expect(container.querySelector('.typing')).toBeNull();
    expect(container.querySelector('.sheet-loading')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('draws shapes, never numbers — nothing in the placeholder can be read as data', () => {
    getOccurrenceDetail.mockImplementation(hang);
    const { container } = mount();
    const skeleton = container.querySelector('[aria-busy="true"]')!;
    // A "0" here would be indistinguishable from a real zero the moment it became 740.
    expect(skeleton.textContent?.replace(/\s/g, '')).toBe('Openingyourcapture.');
    expect(container.querySelectorAll('.sk').length).toBeGreaterThan(0);
  });

  it('picks the weigh-in’s shape from the title it already has, not from the response', () => {
    getOccurrenceDetail.mockImplementation(hang);
    const { container } = mount({ known: { title: 'Weekly weigh-in' } });
    expect(screen.getByText('Weekly weigh-in')).toBeTruthy();
    expect(container.querySelector('.ss-disc-weigh')).toBeTruthy();
  });

  it('swaps the skeleton for the real capture once the detail lands', async () => {
    getOccurrenceDetail.mockResolvedValue(detail());
    const { container } = mount();
    await waitFor(() => expect(screen.getByText('meal-panel')).toBeTruthy());
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('says so plainly when the row is gone, instead of waiting forever', async () => {
    getOccurrenceDetail.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
    const { container } = mount();
    await waitFor(() => expect(screen.getByText(/moved with your new plan/)).toBeTruthy());
    // The skeleton-that-never-resolves is the failure mode this whole change must not introduce.
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('says so plainly when the read fails', async () => {
    getOccurrenceDetail.mockRejectedValue(new Error('offline'));
    const { container } = mount();
    await waitFor(() => expect(screen.getByText(/Couldn't open this just now/)).toBeTruthy());
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('still opens without a known row — the header simply waits with the body', () => {
    getOccurrenceDetail.mockImplementation(hang);
    const { container } = mount({ known: undefined });
    expect(container.querySelector('.ss-head')).toBeNull();
    expect(container.querySelector('.typing')).toBeNull();
  });
});
