/**
 * The ＋ sheet after the 2026-09-01 redesign: quick adds derive from what's tracked, the plan's
 * own activities are never listed (the trail owns their buttons), and the inherited guarantees
 * hold — a failed plan read is never dressed as an empty one, the free line reads nothing from
 * the server so it works in every state, and loading shows shapes, never typing dots.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const usePlan = vi.fn();
const useNutritionDay = vi.fn();
vi.mock('../../../lib/query/index.ts', () => ({
  usePlan: () => usePlan(),
  useNutritionDay: () => useNutritionDay(),
  useInvalidateNutritionDay: () => vi.fn(),
  useUploadProgressPhoto: () => ({ mutateAsync: vi.fn(async () => null), isPending: false }),
}));

const logAdhoc = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const logWater = vi.fn(async (..._a: unknown[]) => 750);
const getProgressPhotosStatus = vi.fn(async (..._a: unknown[]) => ({ enabled: false, count: 0, next_due: null }));
vi.mock('../../../lib/api.ts', () => ({
  logAdhoc: (...a: unknown[]) => logAdhoc(...a),
  logWater: (...a: unknown[]) => logWater(...a),
  recordWeighInToday: vi.fn(async () => ({ weight_kg: 88 })),
  getUnits: vi.fn(async () => null),
  getProgressPhotosStatus: (...a: unknown[]) => getProgressPhotosStatus(...a),
}));
vi.mock('../DoNowSection.tsx', () => ({ DoNowSection: () => null }));

const { QuickAddSheet } = await import('./QuickAddSheet.tsx');

const activity = (over: Record<string, unknown> = {}) => ({
  activity_id: 'a1',
  title: 'Easy run',
  kind: 'user',
  cadence: 'weekly',
  recurrence: '',
  area: 'movement',
  ...over,
});

const basePlan = (activities: unknown[] = []) => ({
  hasPlan: true,
  stage: 'committed',
  activities,
  week: [],
  consistency: { kept: 0, window: 7 },
});

function mount(
  state: { plan?: unknown; planError?: Error | null; day?: unknown },
  props: Partial<{ onClose: () => void; onLogged: () => void; onOpenFood: () => void }> = {},
) {
  usePlan.mockReturnValue({ data: state.plan, error: state.planError ?? null });
  useNutritionDay.mockReturnValue({ data: state.day });
  return render(
    <QuickAddSheet onClose={props.onClose ?? (() => {})} onLogged={props.onLogged ?? (() => {})} {...props} />,
  );
}

/** Every mount fires the photos-status effect; settle it so no state lands after a test ends. */
const settled = () => waitFor(() => expect(getProgressPhotosStatus).toHaveBeenCalled());

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuickAddSheet', () => {
  it('never lists the plan’s own activities — the trail owns their buttons', async () => {
    mount({ plan: basePlan([activity()]), day: null });
    expect(screen.queryByText('Easy run')).toBeNull();
    expect(screen.getByText('Add a workout')).toBeTruthy();
    await settled();
  });

  it('derives rows from what’s tracked: water, meal, practice-with-goal', async () => {
    mount(
      {
        plan: basePlan([activity({ area: 'practice', title: 'Piano practice', goal_title: 'Learn piano' })]),
        day: { date: '2026-09-01', meals: [], has_recent_water: true, has_recent_food: true, water_ml: 500 },
      },
      { onOpenFood: () => {} },
    );
    expect(screen.getByText('A glass of water')).toBeTruthy();
    expect(screen.getByText('0.5 L today')).toBeTruthy();
    expect(screen.getByText('Log a meal')).toBeTruthy();
    expect(screen.getByText('Add a practice')).toBeTruthy();
    expect(screen.getByText('toward Learn piano')).toBeTruthy();
    await settled();
  });

  it('one tap on the water row pours one glass', async () => {
    mount({ plan: basePlan(), day: { date: '2026-09-01', meals: [], has_recent_water: true, water_ml: 500 } });
    fireEvent.click(screen.getByLabelText('Add a glass of water'));
    await waitFor(() => expect(logWater).toHaveBeenCalledWith(250));
  });

  it('an area add expands to a line of text and logs off-plan, tagged with its area', async () => {
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount({ plan: basePlan([activity()]), day: null }, { onLogged, onClose });
    fireEvent.click(screen.getByLabelText('Add a workout'));
    fireEvent.change(screen.getByPlaceholderText(/What did you do/), { target: { value: 'hotel gym, 30 min' } });
    fireEvent.click(screen.getByText('Add it'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('hotel gym, 30 min', undefined, 'movement'));
    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('the meal row is a door to the food module, and only exists when the host has one', async () => {
    const onOpenFood = vi.fn();
    const dayData = { date: '2026-09-01', meals: [], has_recent_food: true };
    mount({ plan: basePlan(), day: dayData }, { onOpenFood });
    fireEvent.click(screen.getByText('Log a meal'));
    expect(onOpenFood).toHaveBeenCalled();
    cleanup();
    mount({ plan: basePlan(), day: dayData });
    expect(screen.queryByText('Log a meal')).toBeNull();
    await settled();
  });

  it('offers the photo row only behind the opt-in', async () => {
    getProgressPhotosStatus.mockResolvedValue({ enabled: true, count: 2, next_due: null });
    mount({ plan: basePlan(), day: null });
    expect(await screen.findByText('Take a progress photo')).toBeTruthy();
    cleanup();
    getProgressPhotosStatus.mockResolvedValue({ enabled: false, count: 0, next_due: null });
    mount({ plan: basePlan(), day: null });
    await settled();
    expect(screen.queryByText('Take a progress photo')).toBeNull();
  });

  it('never reports a failed plan read as nothing-to-add', async () => {
    mount({ plan: undefined, planError: new Error('offline'), day: null });
    expect(screen.queryByText(/Nothing to quick-add/)).toBeNull();
    expect(screen.getByText(/Couldn't reach your plan just now/)).toBeTruthy();
    await settled();
  });

  it('shows row shapes, not typing dots, on the true first load', async () => {
    const { container } = mount({ plan: undefined, planError: null, day: null });
    expect(container.querySelector('.typing')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    await settled();
  });

  it('says so honestly when there is nothing tracked to offer', async () => {
    mount({ plan: basePlan(), day: null });
    expect(screen.getByText(/Nothing to quick-add yet/)).toBeTruthy();
    await settled();
  });

  it('keeps the free line usable in every state — it reads nothing from the server', async () => {
    for (const state of [
      { plan: undefined, planError: null, day: null },
      { plan: undefined, planError: new Error('offline'), day: null },
      { plan: basePlan(), day: null },
    ]) {
      const { container } = mount(state);
      expect(container.querySelector('.ld-free')).toBeTruthy();
      await settled();
      cleanup();
    }
  });
});
