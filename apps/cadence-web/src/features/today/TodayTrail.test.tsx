/**
 * The trail node's step ring, and whether it can say a session happened.
 *
 * The bug this pins (owner, on device 2026-08-16): a session marked done kept a grey ring. The
 * occurrence really was `status: 'done'` in the database, so the instinct was a missed refetch —
 * but the ring had no wire to status at all. It shipped stroked by sky darkness alone (eb4572c),
 * which means it was grey for a finished session and grey for one nobody had started, and a
 * refetch could never have changed that. Only the disc gradient and the ✓ badge were reading
 * status, so "done" was being reported by two visuals out of three.
 */
import { render } from '@testing-library/react';
import { TodayTrail } from './TodayTrail.tsx';
import type { PlanOccurrence, PlanViewData } from '../../lib/api.ts';

vi.mock('../../lib/api.ts', () => ({
  getTodayBrief: () => Promise.resolve({ recap: null }),
}));
vi.mock('../nutrition/TrailFoodStrip.tsx', () => ({ TrailFoodStrip: () => <div /> }));
vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => <span /> }));

const occ = (over: Partial<PlanOccurrence> = {}): PlanOccurrence => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  title: 'Easy run',
  kind: 'user',
  status: 'pending',
  steps: 4, // >1, or the ring is not drawn at all (meal/system tasks stay ringless by design)
  ...over,
});

/** One day, one node — `isToday` keeps it on the first (bright) sky, so the light-sky branch runs. */
function plan(o: PlanOccurrence): PlanViewData {
  return {
    hasPlan: true,
    stage: 'committed',
    activities: [],
    consistency: { kept: 0, window: 7 },
    week: [{ date: '2026-08-16', weekday: 'Sun', dayNum: 16, isToday: true, occurrences: [o] }],
  };
}

const ring = (c: HTMLElement) => c.querySelector('.trail-ring circle');

function draw(o: PlanOccurrence) {
  return render(<TodayTrail plan={plan(o)} onOpen={() => {}} onOpenFood={() => {}} onCoach={() => {}} />);
}

describe('TodayTrail step ring', () => {
  it('goes green once the session is done', () => {
    const { container } = draw(occ({ status: 'done' }));
    // The brand's vitality green, not "some colour that is not the grey": a ring stroked with the
    // sky's own grey is exactly the bug, and any non-green would read as unfinished on device.
    expect(ring(container)?.getAttribute('stroke')).toBe('var(--forest)');
  });

  it('stays grey while the session is still pending', () => {
    const { container } = draw(occ({ status: 'pending' }));
    const stroke = ring(container)?.getAttribute('stroke');
    expect(stroke).toMatch(/^oklch\(/);
    expect(stroke).not.toBe('var(--forest)');
    expect(stroke).not.toBe('var(--sage)');
  });

  /**
   * Brand rule: count what happened, never what broke. A skipped session did not happen, so it
   * earns the same quiet ring as an untouched one — never a green one, and never a red one.
   */
  it('leaves a skipped session grey rather than crediting or scolding it', () => {
    const { container } = draw(occ({ status: 'skipped' }));
    const stroke = ring(container)?.getAttribute('stroke');
    expect(stroke).toMatch(/^oklch\(/);
    expect(stroke).not.toBe('var(--forest)');
    expect(stroke).not.toBe('var(--sage)');
  });

  it('still draws no ring at all for a single-step task, done or not', () => {
    expect(ring(draw(occ({ status: 'done', steps: 1 })).container)).toBeNull();
    expect(ring(draw(occ({ status: 'done', steps: undefined })).container)).toBeNull();
  });

  /** The ✓ badge and the disc gradient are the other two done signals; all three move together. */
  it('keeps the ✓ badge it always had', () => {
    expect(draw(occ({ status: 'done' })).container.querySelector('.trail-check')).not.toBeNull();
    expect(draw(occ({ status: 'pending' })).container.querySelector('.trail-check')).toBeNull();
  });
});
