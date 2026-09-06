/**
 * REGRESSION (2026-09-06, owner-reported, on device). "Press Log breakfast, select Chat… there's
 * no chat." The capture sheet held the tapped tile in state and then opened the meal screen
 * WITHOUT it, so Chat, Voice, Barcode and Search all arrived at the same empty meal — the exact
 * failure the screen this replaced carried `initialMethod` to prevent (PR #359 dropped it).
 *
 * A tile-to-surface router fails silently: the wrong screen opens and nothing throws. So every
 * tile gets a row here, and each row names the thing that can only be true if the method
 * travelled — the composer for chat, the scanner for barcode, the search field for search — plus
 * the negative that pins the bug: none of them lands on the meal's own picker.
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
  createFood: vi.fn(),
  estimateFood: vi.fn(),
  getPlateAdvice: vi.fn(),
  logMealFromFood: vi.fn(),
  logMealFromItems: vi.fn(),
  logPlannedMealItems: vi.fn(),
  portionHintFromResolve: vi.fn(() => null),
  resolveFoods: vi.fn(),
  previewMeal: vi.fn(),
  listRecipes: vi.fn(async () => ({ recipes: [] })),
  markOccurrenceDone: vi.fn(),
  logMeal: vi.fn(),
}));
vi.mock('../../../lib/api.ts', () => api);

/** Partial: only the reads this suite drives are stubbed. The rest — the shared food-library
 *  hooks the screen picked up in `fix/screens-paint-from-cache` — run for real onto the mocked
 *  API above, so this file does not go stale every time a component adopts another cached read. */
vi.mock('../../../lib/query/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/query/index.ts')>()),
  useInvalidateNutritionDay: () => vi.fn(),
  useNutritionDay: () => ({ data: null }),
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

beforeEach(() => {
  vi.clearAllMocks();
  api.getFoodRecents.mockResolvedValue({ status: 'ok', foods: [] });
  api.getUsualAtSlot.mockResolvedValue([]);
  api.getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: null });
  api.searchFoods.mockResolvedValue({ status: 'ok', foods: [] });
  api.listRecipes.mockResolvedValue({ recipes: [] });
  draftApi.getOpenMeal.mockResolvedValue({
    log_id: 'm1',
    date: '2026-09-06',
    meal: 'breakfast',
    items: [],
    macros: {},
    input_method: 'manual',
    state: 'open',
    closes_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
});

afterEach(cleanup);

function renderPanel() {
  return renderWithQuery(<MealCapturePanel detail={DETAIL} setDetail={() => {}} />);
}

/** The tile, and the one thing that can only be on screen if the tapped method travelled. */
const TILES: Array<{ tile: string; landmark: RegExp | string; how: 'label' | 'text' }> = [
  { tile: 'Chat', landmark: 'What did you have?', how: 'label' },
  { tile: 'Voice', landmark: 'What did you have?', how: 'label' },
  { tile: 'Search', landmark: 'Search foods', how: 'label' },
  { tile: 'Barcode', landmark: /Barcode/, how: 'text' },
];

describe('MealCapturePanel — the tapped tile is the door', () => {
  it.each(TILES)('$tile opens its own surface, not the meal picker', async ({ tile, landmark, how }) => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(tile) }));
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
    fireEvent.click(await screen.findByRole('button', { name: /Chat/ }));
    const chatHeading = await screen.findByRole('heading', { name: /Add to breakfast/ });
    expect(chatHeading).toBeInTheDocument();
    cleanup();

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Voice/ }));
    expect(await screen.findByRole('heading', { name: /Add to breakfast/ })).toBeInTheDocument();
    expect(await screen.findByLabelText('What did you have?')).toBeInTheDocument();
  });

  it('backing out of a door lands on the meal, not out of the capture', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Search/ }));
    await screen.findByLabelText('Search foods');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    // The door closed into the meal it appends to — the draft is still open behind it.
    await waitFor(() => expect(screen.getByText('Add everything you had')).toBeInTheDocument());
  });
});
