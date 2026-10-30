/**
 * The capture from the trail is the quick log (2026-10-28, over the cart ruling of 2026-09-07):
 * the day card shows only what is logged, the meal screen is the whole body, the doors are one
 * icon-only row with type-it first (Find became the filter bar, 2026-10-29), and each door opens its surface — a tile-to-surface router
 * fails silently (the wrong screen opens and nothing throws), so every tile gets a row here
 * naming the thing that can only be true if the method travelled, plus the negative that pins
 * the old bug: none of them lands on the meal's own shelves.
 *
 * REGRESSION kept from 2026-09-06 (owner, on device): "Press Log breakfast, select Chat… there's
 * no chat." The tapped method must travel into the meal screen.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OccurrenceDetail } from '../../../lib/api.ts';
import { renderWithQuery } from '../../../test/withQuery.tsx';

const api = vi.hoisted(() => ({
  getFoodRecents: vi.fn(async () => ({ status: 'ok', foods: [] })),
  getUsualAtSlot: vi.fn(async () => ({ items: [], nextCursor: null })),
  getCurrentMealPlan: vi.fn(async () => ({ status: 'ok', plan: null })),
  searchFoods: vi.fn(async () => ({ status: 'ok', foods: [] })),
  getFoodById: vi.fn(),
  previewMeal: vi.fn(),
  listRecipes: vi.fn(async () => ({ recipes: [] })),
  markOccurrenceDone: vi.fn(),
}));
vi.mock('../../../lib/api.ts', () => api);

const day = vi.hoisted(() => ({ data: null as unknown }));
/** Partial: only the reads this suite drives are stubbed. The rest — the shared food-library
 *  hooks — run for real onto the mocked API above, so this file does not go stale every time a
 *  component adopts another cached read. */
vi.mock('../../../lib/query/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/query/index.ts')>()),
  useInvalidateNutritionDay: () => vi.fn(),
  useNutritionDay: () => ({ data: day.data }),
  localTodayIso: () => '2026-09-06',
}));

const draftApi = vi.hoisted(() => ({
  openMealDraft: vi.fn(),
  getOpenMeal: vi.fn(),
  appendFood: vi.fn(),
  appendRecipe: vi.fn(),
  appendParsed: vi.fn(),
  removeDraftItem: vi.fn(),
  setDraftAmount: vi.fn(),
  setDraftMeal: vi.fn(),
  closeMeal: vi.fn(),
  editMealParts: vi.fn(),
  savePartAsRecipe: vi.fn(),
}));
vi.mock('../../../lib/api/meal-draft.ts', () => draftApi);

// The scanner reaches for a camera the moment it opens; jsdom has none, and this test is about
// which surface arrives, not about decoding.
vi.mock('../../food/useBarcodeScan.ts', () => ({
  useBarcodeScan: () => ({ status: 'idle', statusNote: '', videoRef: { current: null }, stop: vi.fn() }),
}));

const { MealCapturePanel } = await import('./MealCapturePanel.tsx');

const DETAIL = {
  occurrence_id: 'occ-1',
  title: 'Log breakfast',
  date: '2026-09-06',
  status: 'pending',
  schedule: { time_of_day: '08:00' },
} as unknown as OccurrenceDetail;

const openMeal = (over: Record<string, unknown> = {}) => ({
  log_id: 'm1',
  date: '2026-09-06',
  meal: 'breakfast',
  items: [],
  macros: {},
  input_method: 'manual',
  state: 'open',
  closes_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  day.data = null;
  api.getFoodRecents.mockResolvedValue({ status: 'ok', foods: [] });
  api.getUsualAtSlot.mockResolvedValue({ items: [], nextCursor: null });
  api.getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: null });
  api.searchFoods.mockResolvedValue({ status: 'ok', foods: [] });
  api.listRecipes.mockResolvedValue({ recipes: [] });
  draftApi.getOpenMeal.mockResolvedValue(null);
  draftApi.openMealDraft.mockResolvedValue(openMeal());
});

afterEach(cleanup);

function renderPanel(props: Partial<Parameters<typeof MealCapturePanel>[0]> = {}) {
  return renderWithQuery(
    <MealCapturePanel
      detail={DETAIL}
      known={{ title: 'Log breakfast', date: '2026-09-06' }}
      setDetail={() => {}}
      {...props}
    />,
  );
}

/**
 * Turn 1 (2026-10-29): typing and voice open "What did you have?" as a sheet OVER the shelves, so
 * for them the proof the method travelled is the sheet itself; the barcode keeps its own surface,
 * and there the old negative still holds — it must not land on the shelves.
 */
describe('MealCapturePanel — the tapped tile is the door', () => {
  it.each(['Type it', 'Voice'])('%s opens "What did you have?"', async (tile) => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${tile}$`) }));
    expect(await screen.findByRole('dialog', { name: 'What did you have?' })).toBeInTheDocument();
  });

  it('Barcode opens its own surface, not the meal picker', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Barcode$/ }));
    expect(await screen.findAllByText(/Barcode/)).not.toHaveLength(0);
    // The bug, stated: every tile used to land here instead.
    expect(screen.queryByRole('tablist', { name: 'Shelves' })).toBeNull();
  });

  it('typing and voice open the SAME sheet — voice is not a second screen', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Type it$/ }));
    const typed = await screen.findByRole('dialog', { name: 'What did you have?' });
    expect(typed.querySelector('h2')?.textContent).toBe('What did you have?');
    cleanup();

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Voice$/ }));
    const spoken = await screen.findByRole('dialog', { name: 'What did you have?' });
    expect(spoken.querySelector('h2')?.textContent).toBe('What did you have?');
  });

  it('closing the sheet lands on the meal, not out of the capture', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Type it$/ }));
    await screen.findByRole('dialog', { name: 'What did you have?' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // The sheet closed into the meal it appends to — the draft is still open behind it.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'What did you have?' })).toBeNull());
    expect(screen.getByRole('tablist', { name: 'Shelves' })).toBeInTheDocument();
  });
});

describe('MealCapturePanel — the cart', () => {
  it('opens on the slot the trail named, on its day, before the detail has landed', async () => {
    renderPanel({ detail: null, known: { title: 'Log breakfast', date: '2026-09-05' } });
    await waitFor(() => expect(draftApi.openMealDraft).toHaveBeenCalledWith({ meal: 'breakfast', date: '2026-09-05' }));
    expect(await screen.findByRole('tablist', { name: 'Shelves' })).toBeInTheDocument();
    // No band above the meal repeating its name and the old "nothing counts" line.
    expect(screen.queryByText(/CAPTURE/)).toBeNull();
  });

  it('the day card shows only what is logged — an open draft is taken back out of the day', async () => {
    day.data = {
      date: '2026-09-06',
      meals: [
        { log_id: 'a', meal: 'breakfast', items: [], macros: { kcal: 300, protein_g: 20 }, state: 'closed' },
        { log_id: 'b', meal: 'lunch', items: [], macros: { kcal: 150, protein_g: 10 }, state: 'open' },
      ],
      totals: { kcal: 450, protein_g: 30, carbs_g: 0, fat_g: 0 },
      provisional_totals: {},
      confirmed_count: 2,
      provisional_count: 0,
      targets: { kcal: 2150, protein_g: 160, carbs_g: 220, fat_g: 70 },
      left: { kcal: 1700 },
      burn_kcal: 0,
      eatback_kcal: 0,
      eatback_pct: 50,
    };
    renderPanel();
    // 2150 − 300 logged = 1,850 — not 1,700, which would have counted the open lunch.
    expect(await screen.findByText('1,850')).toBeInTheDocument();
    expect(screen.getByText('LEFT')).toBeInTheDocument();
    expect(screen.getByText('20 / 160')).toBeInTheDocument();
    // One kcal figure, not two that disagree.
    expect(screen.queryByText(/left today/i)).toBeNull();
    expect(screen.queryByText(/LEFT AFTER THIS/)).toBeNull();
  });

  it('logging ticks the row and closes the sheet', async () => {
    draftApi.openMealDraft.mockResolvedValue(
      openMeal({ items: [{ name: 'Oats', qty: 1, unit: 'cup', est: { kcal: 300 } }] }),
    );
    draftApi.closeMeal.mockResolvedValue(
      openMeal({ state: 'closed', items: [{ name: 'Oats', qty: 1, unit: 'cup', est: { kcal: 300 } }] }),
    );
    const setDetail = vi.fn();
    const onLogged = vi.fn();
    const onClose = vi.fn();
    renderPanel({ setDetail, onLogged, onClose });
    fireEvent.click(await screen.findByRole('button', { name: /Log breakfast · 300 kcal/ }));
    await waitFor(() => expect(draftApi.closeMeal).toHaveBeenCalledWith('m1'));
    expect(setDetail).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }));
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
