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
import { fireEvent, render } from '@testing-library/react';
import { TodayTrail } from './TodayTrail.tsx';
import type { MealMacros, NutritionDayData, PlanOccurrence, PlanViewData } from '../../lib/api.ts';

/** Today's nutrition, as the trail's calorie card sees it. Reset to "nothing loaded" per test. */
const nut = vi.hoisted(() => ({ day: null as NutritionDayData | null }));
/** The weeks before today, as the trail's back-scroll hook hands them over. Empty per test. */
const earlier = vi.hoisted(() => ({ days: [] as unknown[], loading: false, failed: false }));
vi.mock('../../lib/query/index.ts', () => ({
  useNutritionDay: () => ({ data: nut.day }),
  useClockUnit: () => '24h',
  useEarlierDays: () => earlier,
}));
vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => <span /> }));

beforeEach(() => {
  nut.day = null;
});

function nutritionDay(targets: MealMacros | null, kcal: number): NutritionDayData {
  return {
    date: '2026-08-16',
    meals: [],
    totals: { kcal },
    provisional_totals: {},
    confirmed_count: 0,
    provisional_count: 0,
    targets,
    left: null,
    burn_kcal: 0,
    eatback_kcal: 0,
    eatback_pct: 0,
  };
}

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

function draw(o: PlanOccurrence, onOpenFood: () => void = () => {}) {
  return render(<TodayTrail plan={plan(o)} onOpen={() => {}} onOpenFood={onOpenFood} onCoach={() => {}} />);
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

/**
 * The warming hint (Gap 4, PLAN-CHANGES.md): an occurrence whose session hasn't been written yet
 * used to render as an ordinary disc, so the ~30-60s wait was discovered by tapping. The honest
 * hint before the tap is a dashed ring in the step ring's own slot — quiet, no copy, no spinner —
 * plus the accessible "still being written". These pin the applicability edges: pending
 * coach-programmed sessions only, and an absent field (older server) stays a no-claim.
 */
describe('TodayTrail warming hint', () => {
  const warming = (c: HTMLElement) => c.querySelector('.trail-ring.is-warming');
  const label = (c: HTMLElement) => c.querySelector('button.trail-node')?.getAttribute('aria-label');

  it('draws the dashed ring and says so accessibly while the session is still being written', () => {
    const { container } = draw(occ({ steps: undefined, session_ready: false }));
    expect(warming(container)).not.toBeNull();
    expect(warming(container)?.querySelector('circle')?.getAttribute('stroke-dasharray')).toBe('2 5');
    expect(label(container)).toBe('Easy run — still being written');
  });

  it('drops the hint once the session exists — the step ring takes over', () => {
    const { container } = draw(occ({ session_ready: true }));
    expect(warming(container)).toBeNull();
    expect(container.querySelector('.trail-ring')).not.toBeNull(); // steps: 4 → the ordinary ring
    expect(label(container)).toBe('Easy run');
  });

  it('stays silent when an older server sends no field — absence is a no-claim, never a hint', () => {
    const { container } = draw(occ({ steps: undefined }));
    expect(warming(container)).toBeNull();
    expect(label(container)).toBe('Easy run');
  });

  it('never marks a row whose tap starts no write: captures, and sessions already touched', () => {
    // A weigh-in opens the capture sheet, not a session — no wait to warn about.
    expect(warming(draw(occ({ title: 'Weigh-in', steps: undefined, session_ready: false })).container)).toBeNull();
    // Done/skipped rows are past tense; the hint is only for a tap that would start the write.
    expect(warming(draw(occ({ status: 'done', steps: undefined, session_ready: false })).container)).toBeNull();
    expect(warming(draw(occ({ status: 'skipped', steps: undefined, session_ready: false })).container)).toBeNull();
  });
});

/**
 * Food on the trail (Food Journey 01/3B): the strip sits full-width at the top of today — under
 * the day label, above the nodes — because the 134px coach bay could never hold three macro bars.
 * Still IN the day per the 2a ruling, still the one door to the Food home, and still absent
 * entirely when food is idle (the deeper states live in TrailFoodStrip.test.tsx).
 */
describe('TodayTrail food strip', () => {
  const strip = (c: HTMLElement) => c.querySelector('.trail-food');

  it("shows what's left against the target, at the top of today", () => {
    nut.day = nutritionDay({ kcal: 1500 }, 1150);
    const { container } = draw(occ());

    expect(strip(container)?.textContent).toContain('350');
    expect(strip(container)?.textContent).toContain('LEFT');
    // Under the day label, above the nodes — the day opens with its food.
    expect(strip(container)?.previousElementSibling?.className).toContain('trail-daylabel');
    expect(strip(container)?.nextElementSibling?.className).toContain('trail-nodes');
    // And out of the bay: her line and her face keep it to themselves.
    expect(container.querySelector('.trail-bay .trail-food')).toBeNull();
  });

  /**
   * The gate is a food SIGNAL, never the truthiness of `targets` — the API hands back `{}` for
   * someone who has never set any, and `{}` is truthy. No target, no meals, no recent food and
   * no countdown: no strip. The day simply starts at its first node.
   */
  it('is absent when food is idle', () => {
    nut.day = nutritionDay({}, 420);
    expect(strip(draw(occ()).container)).toBeNull();

    nut.day = nutritionDay(null, 420);
    expect(strip(draw(occ()).container)).toBeNull();

    nut.day = null; // nothing loaded yet — still no empty state
    expect(strip(draw(occ()).container)).toBeNull();
  });

  it('opens the Food home when tapped', () => {
    nut.day = nutritionDay({ kcal: 1500 }, 1150);
    const onOpenFood = vi.fn();
    const { container } = draw(occ(), onOpenFood);

    fireEvent.click(strip(container)!);
    expect(onOpenFood).toHaveBeenCalledTimes(1);
  });
});

/**
 * Scrolling back (owner, 2026-09-01): the trail stops at today and runs forward, and there was no
 * way to log a breakfast forgotten on Monday. One tap loads the week before; the labels stay
 * relative to TODAY rather than to the top of the list, so "tomorrow" does not move with it.
 */
describe('TodayTrail earlier days', () => {
  const week: PlanViewData['week'] = [
    { date: '2026-08-16', weekday: 'Sun', dayNum: 16, isToday: true, occurrences: [occ()] },
    { date: '2026-08-17', weekday: 'Mon', dayNum: 17, isToday: false, occurrences: [] },
  ];
  const twoDays = (): PlanViewData => ({ ...plan(occ()), week });

  beforeEach(() => {
    earlier.days = [];
    earlier.loading = false;
    earlier.failed = false;
  });

  it('offers last week above today, and asks for one more week per tap', () => {
    const { getByText } = render(
      <TodayTrail plan={twoDays()} onOpen={() => {}} onOpenFood={() => {}} onCoach={() => {}} />,
    );
    expect(getByText('↑ See last week')).toBeTruthy();
    fireEvent.click(getByText('↑ See last week'));
    expect(getByText('↑ See the week before')).toBeTruthy();
  });

  it('draws the loaded days on top, labelled against today', () => {
    earlier.days = [
      {
        date: '2026-08-15',
        weekday: 'Sat',
        dayNum: 15,
        isToday: false,
        occurrences: [occ({ occurrence_id: 'o0', title: 'Log breakfast', kind: 'system', steps: undefined })],
      },
    ];
    const { container, getByText } = render(
      <TodayTrail plan={twoDays()} onOpen={() => {}} onOpenFood={() => {}} onCoach={() => {}} />,
    );
    const labels = [...container.querySelectorAll('.trail-daylabel span')].map((el) => el.textContent);
    expect(labels).toEqual(['YESTERDAY · SAT 15 AUG', 'TODAY · SUN 16 AUG', 'TOMORROW · MON 17 AUG']);
    // The past day's own row is there to tap — that is the whole point.
    expect(getByText('Log breakfast')).toBeTruthy();
  });

  it('says so when a week could not be loaded', () => {
    earlier.failed = true;
    const { getByText } = render(
      <TodayTrail plan={twoDays()} onOpen={() => {}} onOpenFood={() => {}} onCoach={() => {}} />,
    );
    expect(getByText(/Couldn.t load that week/)).toBeTruthy();
  });
});

/** The disc's time is written in the clock the person chose (Settings → Units → Clock). */
describe('TodayTrail clock', () => {
  it('shows the stored 24-hour time as-is under the 24-hour setting', () => {
    const { getByText } = draw(occ({ time_of_day: '06:00' }));
    expect(getByText('06:00')).toBeTruthy();
  });
});
