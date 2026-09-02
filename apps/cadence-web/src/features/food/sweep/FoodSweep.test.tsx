/**
 * What these pin (canvas S3/S4; MEAL-LOGGING.md "The Sunday sweep" + P3 addenda): the toggles
 * select ONE commit's subset (never per-proposal accepts); zero kept leaves declining as the only
 * door; a dismiss really dismisses and the surfaces vanish; the tidy offer speaks only about
 * proposals with logs to re-read; the tidy call carries the right ids and its Undo is visible on
 * the surface; and every count in the copy comes from the data, never from the canvas's examples.
 *
 * The harness wires hook → components exactly as the integrator will (see useFoodSweep's doc).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FoodSweepProposal, PendingFoodSweep, Recipe } from '@cadence/shared';
import { FoodSweepCard } from './FoodSweepCard.tsx';
import { FoodSweepSheet } from './FoodSweepSheet.tsx';
import { FoodSweepTidy } from './FoodSweepTidy.tsx';
import { useFoodSweep } from './useFoodSweep.ts';
import * as api from '../../../lib/api/meal-draft.ts';

vi.mock('../../../lib/api/meal-draft.ts', () => ({
  getFoodSweep: vi.fn(),
  commitFoodSweep: vi.fn(),
  tidyFoodSweep: vi.fn(),
  revertFoodTidy: vi.fn(),
  dismissFoodSweep: vi.fn(),
}));

function proposal(over: Partial<FoodSweepProposal> & { id: string }): FoodSweepProposal {
  return {
    yield_servings: 1,
    name: 'Chia bowl',
    members: [
      { food_id: 'f1', name: 'yogurt' },
      { food_id: 'f2', name: 'chia' },
      { food_id: 'f3', name: 'whey' },
      { food_id: 'f4', name: 'strawberries' },
    ],
    seen_count: 5,
    slot: 'breakfast',
    line: 'Five mornings, always these four together.',
    macros_per_serving: { kcal: 348, protein_g: 47, carbs_g: 22, fat_g: 9 },
    tidy_log_ids: ['l1', 'l2', 'l3', 'l4', 'l5'],
    ...over,
  };
}

const sweepFix = (): PendingFoodSweep => ({
  built_at: '2026-08-30T06:00:00Z',
  proposals: [
    proposal({ id: 'p1' }),
    proposal({
      id: 'p2',
      name: 'Chickpea & spinach stew',
      yield_servings: 4,
      members: [
        { food_id: 'f5', name: 'chickpeas' },
        { food_id: 'f6', name: 'spinach' },
        { food_id: 'f7', name: 'tomatoes' },
      ],
      seen_count: 3,
      slot: 'dinner',
      line: 'Looks like it made four. Shall I write it up properly?',
      macros_per_serving: { kcal: 125 },
      tidy_log_ids: [],
    }),
    proposal({
      id: 'p3',
      name: 'Coffee & oat milk',
      members: [
        { food_id: 'f8', name: 'coffee' },
        { food_id: 'f9', name: 'oat milk' },
      ],
      seen_count: 6,
      line: 'Two things — maybe not worth a row.',
      macros_per_serving: { kcal: 62 },
      tidy_log_ids: [],
    }),
  ],
});

function recipeFix(id: string, name: string, servings: number): Recipe {
  return {
    recipe_id: id,
    name,
    source: 'user',
    servings,
    ingredients: [],
    steps: [],
    macros_per_serving: { kcal: 348 },
    tags: [],
    saved: true,
  };
}

/** The integrator's wiring, verbatim from useFoodSweep's doc comment. */
function Flow() {
  const sw = useFoodSweep();
  const [open, setOpen] = useState(false);
  return (
    <>
      {sw.phase === 'offered' && !open && sw.sweep && (
        <FoodSweepCard sweep={sw.sweep} onOpen={() => setOpen(true)} />
      )}
      {open && (sw.phase === 'offered' || sw.phase === 'committing') && sw.sweep && (
        <FoodSweepSheet
          sweep={sw.sweep}
          busy={sw.phase === 'committing'}
          error={sw.error}
          onBack={() => setOpen(false)}
          onCommit={(ids) => void sw.commit(ids)}
          onDismiss={() => {
            setOpen(false);
            void sw.dismiss();
          }}
        />
      )}
      {open &&
        (sw.phase === 'tidyOffer' || sw.phase === 'tidying' || sw.phase === 'done' || sw.phase === 'reverted') && (
          <FoodSweepTidy
            saved={sw.saved}
            tidyable={sw.tidyable}
            phase={sw.phase}
            tidiedCount={sw.tidiedCount}
            error={sw.error}
            onTidy={() => void sw.tidy()}
            onSkip={() => {
              sw.skipTidy();
              setOpen(false);
            }}
            onUndo={() => void sw.revert()}
            onClose={() => setOpen(false)}
          />
        )}
    </>
  );
}

let queryClient: QueryClient;
let invalidateSpy: ReturnType<typeof vi.spyOn>;

function mount() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  return render(
    <QueryClientProvider client={queryClient}>
      <Flow />
    </QueryClientProvider>,
  );
}

async function openSheet() {
  const r = mount();
  fireEvent.click(await screen.findByRole('button', { name: /kept turning up/ }));
  return r;
}

beforeEach(() => {
  vi.mocked(api.getFoodSweep).mockResolvedValue(sweepFix());
  vi.mocked(api.commitFoodSweep).mockResolvedValue({
    saved: [recipeFix('r1', 'Chia bowl', 1), recipeFix('r2', 'Chickpea & spinach stew', 4)],
    tidy: [
      { proposal_id: 'p1', log_count: 5 },
      { proposal_id: 'p2', log_count: 0 },
    ],
  });
  vi.mocked(api.tidyFoodSweep).mockResolvedValue({ tidied: 5 });
  vi.mocked(api.revertFoodTidy).mockResolvedValue({ reverted: 5 });
  vi.mocked(api.dismissFoodSweep).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the entry card and S3', () => {
  it('counts what turned up from the data and opens the sheet', async () => {
    await openSheet();
    expect(screen.getByText('Your week in food')).toBeInTheDocument();
    expect(screen.getByText('WHAT I NOTICED')).toBeInTheDocument();
    // The numbers-honesty lines: every figure from the fixture, none from the canvas example.
    expect(screen.getByText('Saves as a meal · 348 kcal · named from your own words')).toBeInTheDocument();
    expect(screen.getByText('Saves as a recipe · 4 servings · 125 per serving')).toBeInTheDocument();
    expect(screen.getByText('Five mornings, always these four together.')).toBeInTheDocument();
    expect(screen.getByText('yogurt · chia · whey · strawberries')).toBeInTheDocument();
    expect(
      screen.getByText("Nothing's saved until you say so, and none of this touches what you already logged."),
    ).toBeInTheDocument();
    // Default ON per proposal — with three kept, the door counts three.
    expect(screen.getByRole('button', { name: "Add the three I've kept" })).toBeInTheDocument();
    expect(vi.mocked(api.getFoodSweep)).toHaveBeenCalled();
  });

  it('toggles select the commit subset — one commit, never per-proposal accepts', async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('switch', { name: 'Keep Coffee & oat milk' }));
    fireEvent.click(screen.getByRole('button', { name: "Add the two I've kept" }));
    await waitFor(() => expect(vi.mocked(api.commitFoodSweep)).toHaveBeenCalledExactlyOnceWith(['p1', 'p2']));
  });

  it('zero toggled leaves declining as the only action', async () => {
    await openSheet();
    for (const name of ['Keep Chia bowl', 'Keep Chickpea & spinach stew', 'Keep Coffee & oat milk']) {
      fireEvent.click(screen.getByRole('switch', { name }));
    }
    expect(screen.queryByRole('button', { name: /Add the .* kept/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'None of these, thanks' })).toBeInTheDocument();
  });

  it('dismiss calls dismiss and the surfaces render nothing after', async () => {
    const { container } = await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'None of these, thanks' }));
    await waitFor(() => expect(vi.mocked(api.dismissFoodSweep)).toHaveBeenCalledOnce());
    expect(container.querySelector('.sw-card')).toBeNull();
    expect(container.querySelector('.sw-sheet')).toBeNull();
  });
});

describe('S4 — the tidy offer', () => {
  async function commitTwo() {
    await openSheet();
    fireEvent.click(screen.getByRole('switch', { name: 'Keep Coffee & oat milk' }));
    fireEvent.click(screen.getByRole('button', { name: "Add the two I've kept" }));
    await screen.findByText('Two added');
  }

  it('commit advances to the tidy step; only log_count>0 proposals are offered, counts from data', async () => {
    await commitTwo();
    expect(screen.getByText('In your cookbook')).toBeInTheDocument();
    // Twice by design: the cookbook row and the diagram's AFTER panel both name it.
    expect(screen.getAllByText('Chia bowl')).toHaveLength(2);
    expect(screen.getByText('a meal')).toBeInTheDocument();
    expect(screen.getByText('makes 4')).toBeInTheDocument();
    // The offer speaks only about p1 (5 logs); the stew's 0 keeps it out of every line.
    expect(
      screen.getByText(
        'Want me to tidy the week behind you too? Five breakfasts would read as Chia bowl instead of four rows each. Same numbers.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('348 kcal before, 348 kcal after — on all five days. Only the reading changes.'),
    ).toBeInTheDocument();
    expect(screen.getByText('4 things')).toBeInTheDocument();
    expect(
      screen.getByText('Any that had an extra thing in them keep their extra, loose, outside the bracket.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tidy the five breakfasts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave the past alone' })).toBeInTheDocument();
    expect(screen.queryByText(/dinners/)).toBeNull();
  });

  it('tidy calls with the offered ids only, shows the visible Undo, and refreshes the diary read', async () => {
    await commitTwo();
    fireEvent.click(screen.getByRole('button', { name: 'Tidy the five breakfasts' }));
    await waitFor(() => expect(vi.mocked(api.tidyFoodSweep)).toHaveBeenCalledExactlyOnceWith(['p1']));
    expect(await screen.findByText('Tidied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('Undo calls revert while the sheet is still open, and refreshes the diary read again', async () => {
    await commitTwo();
    fireEvent.click(screen.getByRole('button', { name: 'Tidy the five breakfasts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(vi.mocked(api.revertFoodTidy)).toHaveBeenCalledOnce());
    expect(await screen.findByText('Put back as it was.')).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it('with nothing tidyable the offer stays silent and Done is the one door', async () => {
    vi.mocked(api.commitFoodSweep).mockResolvedValue({
      saved: [recipeFix('r1', 'Chia bowl', 1)],
      tidy: [{ proposal_id: 'p1', log_count: 0 }],
    });
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: "Add the three I've kept" }));
    await screen.findByText('One added');
    expect(screen.queryByText(/tidy the week behind you/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Tidy the/ })).toBeNull();
  });
});
