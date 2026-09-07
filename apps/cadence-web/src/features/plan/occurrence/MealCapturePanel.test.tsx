/**
 * The capture from the trail is the cart (owner, 2026-09-07): the ring shows only what is
 * logged, the meal screen is the body, the doors are one row with Find first, and each door
 * opens its own surface — a tile-to-surface router fails silently (the wrong screen opens and
 * nothing throws), so every tile gets a row here naming the thing that can only be true if the
 * method travelled, plus the negative that pins the old bug: none of them lands on the meal's
 * own picker.
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
  getUsualAtSlot: vi.fn(async () => []),
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
  api.getUsualAtSlot.mockResolvedValue([]);
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

/** The tile, and the one thing that can only be on screen if the tapped method travelled. */
const TILES: Array<{ tile: string; landmark: RegExp | string; how: 'label' | 'text' }> = [
  { tile: 'Find', landmark: 'Find a food', how: 'label' },
  { tile: 'Chat', landmark: 'What did you have?', how: 'label' },
  { tile: 'Voice', landmark: 'What did you have?', how: 'label' },
  { tile: 'Barcode', landmark: /Barcode/, how: 'text' },
];

describe('MealCapturePanel — the tapped tile is the door', () => {
  it.each(TILES)('$tile opens its own surface, not the meal picker', async ({ tile, landmark, how }) => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${tile}$`) }));
    if (how === 'label') {
      expect(await screen.findByLabelText(landmark as string)).toBeInTheDocument();
    } else {
      expect(await screen.findAllByText(landmark)).not.toHaveLength(0);
    }
    // The bug, stated: every tile used to land here instead.
    expect(screen.queryByText('Add everything you had')).toBeNull();
  });

  it('chat and voice open the SAME composer — voice is not a second screen', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Chat$/ }));
    expect(await screen.findByRole('heading', { name: /Add to breakfast/ })).toBeInTheDocument();
    cleanup();

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Voice$/ }));
    expect(await screen.findByRole('heading', { name: /Add to breakfast/ })).toBeInTheDocument();
    expect(await screen.findByLabelText('What did you have?')).toBeInTheDocument();
  });

  it('backing out of a door lands on the meal, not out of the capture', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /^Find$/ }));
    await screen.findByLabelText('Find a food');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    // The door closed into the meal it appends to — the draft is still open behind it.
    await waitFor(() => expect(screen.getByText('Add everything you had')).toBeInTheDocument());
  });
});

describe('MealCapturePanel — the cart', () => {
  it('opens on the slot the trail named, on its day, before the detail has landed', async () => {
    renderPanel({ detail: null, known: { title: 'Log breakfast', date: '2026-09-05' } });
    await waitFor(() => expect(draftApi.openMealDraft).toHaveBeenCalledWith({ meal: 'breakfast', date: '2026-09-05' }));
    expect(await screen.findByText('Add everything you had')).toBeInTheDocument();
    // No band above the meal repeating its name and the old "nothing counts" line.
    expect(screen.queryByText(/CAPTURE/)).toBeNull();
  });

  it('the ring shows only what is logged — an open draft is taken back out of the day', async () => {
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
    expect(screen.getByText('LEFT TODAY')).toBeInTheDocument();
    expect(screen.getByText('20 / 160g')).toBeInTheDocument();
    // One kcal figure on the strip, not two that disagree.
    expect(screen.queryByText(/left today/)).toBeNull();
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
