/**
 * What the person SEES, in order.
 *
 * The hook has its own tests; these exist because this repo has twice shipped a status line that
 * was correct in the unit and never reached the screen (PLAN.md, 2026-08-17 and 2026-08-21). So
 * every assertion here is on rendered output — the progress copy visible during the wait, the
 * reading visible before any number exists, and the edited text actually leaving for the server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = { readMealPhoto: vi.fn(), logMealFromReading: vi.fn(), previewMealFromReading: vi.fn() };
vi.mock('../../lib/api.ts', () => ({
  readMealPhoto: (...a: unknown[]) => api.readMealPhoto(...a),
  logMealFromReading: (...a: unknown[]) => api.logMealFromReading(...a),
  previewMealFromReading: (...a: unknown[]) => api.previewMealFromReading(...a),
  logPreviewedMeal: vi.fn(),
}));
// The draft-mode numbers ride MealParseCard, which reads the day cache's invalidator.
vi.mock('../../lib/query/index.ts', () => ({ useInvalidateNutritionDay: () => vi.fn() }));

const { PhotoReadPanel } = await import('./PhotoReadPanel.tsx');

const READING = 'Assume a 250ml latte: roughly 200ml milk and 50ml espresso. I cannot see the milk type.';
const ROW = { log_id: 'm1', meal: 'breakfast' };
const PHOTO = 'data:image/jpeg;base64,xxx';

beforeEach(() => {
  vi.clearAllMocks();
  api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: READING, error: null });
  api.logMealFromReading.mockResolvedValue(ROW);
});

const setup = () => {
  const onLogged = vi.fn();
  render(<PhotoReadPanel photo={PHOTO} meal="breakfast" onLogged={onLogged} onBack={() => {}} />);
  return { onLogged, user: userEvent.setup() };
};

describe('PhotoReadPanel', () => {
  /** The caption is evidence the photo cannot give, so it must reach stage 1 — not stage 2. */
  it('sends the caption to the READ, where the eyes can use it', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('A few words about the photo'), 'a small latte');
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    expect(api.readMealPhoto).toHaveBeenCalledWith(PHOTO, 'a small latte');
  });

  it('shows the reading on screen before any number is computed', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));

    await waitFor(() => expect(screen.getByLabelText('What the photo shows')).toBeTruthy());
    expect((screen.getByLabelText('What the photo shows') as HTMLTextAreaElement).value).toBe(READING);
    // The confirm is offered, and nothing has been logged yet.
    expect(screen.getByRole('button', { name: /log to breakfast/i })).toBeTruthy();
    expect(api.logMealFromReading).not.toHaveBeenCalled();
  });

  /** The correction is the entire reason for the split — it must be what leaves. */
  it('logs the EDITED reading, not the original', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    const box = await screen.findByLabelText('What the photo shows');

    await user.clear(box);
    await user.type(box, 'Oat milk, and the large size.');
    await user.click(screen.getByRole('button', { name: /log to breakfast/i }));

    await waitFor(() =>
      expect(api.logMealFromReading).toHaveBeenCalledWith(
        expect.objectContaining({ reading: 'Oat milk, and the large size.', meal: 'breakfast' }),
      ),
    );
  });

  /**
   * Regression: the reading block was gated on `r.reading` being non-empty, so clearing the box to
   * rewrite it unmounted the field — the person most determined to correct the reading was the one
   * it broke for. Caught by the edit test above sending `reading: ""`.
   */
  it('keeps the box on screen when it is cleared', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    const box = await screen.findByLabelText('What the photo shows');
    await user.clear(box);
    expect(screen.getByLabelText('What the photo shows')).toBeTruthy();
  });

  it('narrates the wait instead of going blank', async () => {
    let resolve!: (v: unknown) => void;
    api.readMealPhoto.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));

    // Something true and specific is on screen from the first frame of the wait.
    await waitFor(() => expect(screen.getByText('Sending your photo…')).toBeTruthy());
    resolve({ photo_ref: 'ref/1.jpg', reading: READING, error: null });
  });

  /** A failed read must not cost the meal — the 2026-08-20 rule, in the UI this time. */
  it('still offers to log from the caption when the read fails', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('nope'));
    const { user } = setup();
    await user.type(screen.getByLabelText('A few words about the photo'), 'a small latte');
    await user.click(screen.getByRole('button', { name: /have a look/i }));

    const fallback = await screen.findByRole('button', { name: /log “a small latte” to breakfast/i });
    await user.click(fallback);
    await waitFor(() => expect(api.logMealFromReading).toHaveBeenCalledWith(expect.objectContaining({ reading: '' })));
  });

  it('hands the logged meal back so the screen can settle it', async () => {
    const { user, onLogged } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /log to breakfast/i }));
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith(ROW));
  });
});

/**
 * Inside an open meal (the quick log's photo door). The owner's report, 2026-10-31: the reading was
 * a markdown summary well past 500 characters, it went to the words path's preview, and every
 * photo came back "meal preview failed: 400". Then: show the numbers before adding.
 */
describe('PhotoReadPanel — draft mode', () => {
  const LONG = `**Compact Summary for Data Entry:**\n${'* Mozzarella cheese, full-fat, baked (~40-50g)\n'.repeat(20)}`;
  const PRICED = {
    meal: 'dinner',
    raw_text: `Two slices — ${LONG}`,
    items: [
      { name: 'Hawaiian pizza', qty: 2, unit: 'slice', est: { kcal: 560, protein_g: 24, carbs_g: 66, fat_g: 21 } },
    ],
    macros: { kcal: 560, protein_g: 24, carbs_g: 66, fat_g: 21 },
    confidence: 0.7,
    flags: {},
  };

  const setupDraft = () => {
    const appendDraft = vi.fn().mockResolvedValue(true);
    render(
      <PhotoReadPanel
        photo={PHOTO}
        meal="dinner"
        mode="draft"
        appendDraft={appendDraft}
        onLogged={() => {}}
        onBack={() => {}}
      />,
    );
    return { appendDraft, user: userEvent.setup() };
  };

  beforeEach(() => {
    api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: LONG, error: null });
    api.previewMealFromReading.mockResolvedValue(PRICED);
  });

  it('prices the whole reading on the photo route, however long it runs', async () => {
    const { user } = setupDraft();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));
    await waitFor(() =>
      expect(api.previewMealFromReading).toHaveBeenCalledWith(
        expect.objectContaining({ reading: LONG, meal: 'dinner' }),
      ),
    );
    expect(LONG.length).toBeGreaterThan(500);
  });

  it('shows the foods and their numbers BEFORE anything joins the meal', async () => {
    const { user, appendDraft } = setupDraft();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));

    expect(await screen.findByText('~560 kcal')).toBeTruthy();
    expect(screen.getByText(/24g protein/)).toBeTruthy();
    expect(appendDraft).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add to dinner' }));
    await waitFor(() => expect(appendDraft).toHaveBeenCalledWith(PRICED.items, PRICED.raw_text));
  });

  it("a row waiting on the coach's question offers her answers as buttons on the photo card too", async () => {
    api.previewMealFromReading.mockResolvedValueOnce({
      ...PRICED,
      items: [
        {
          name: 'milk',
          question: 'Whole milk, 2% or skim?',
          choices: ['Whole milk', '2%', 'Skim'],
          asked_about: 'milk',
        },
        ...PRICED.items,
      ],
    });
    const { user } = setupDraft();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));

    expect(await screen.findByRole('button', { name: 'Whole milk' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Something else' })).toBeTruthy();
    expect(screen.getByText('Whole milk, 2% or skim?')).toBeTruthy();
    // The same card as the typed door: a question an amount cannot answer gets no amount chips,
    // counts nothing, and is named for what it is.
    expect(screen.queryByRole('button', { name: '1 glass' })).toBeNull();
    expect(screen.getByText('~560 kcal')).toBeTruthy();
    expect(screen.getByText('1 QUESTION TO SETTLE')).toBeTruthy();
  });

  it('goes back to the reading from the numbers, to fix it and price again', async () => {
    const { user } = setupDraft();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));
    await screen.findByText('~560 kcal');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('What the photo shows')).toBeTruthy();
    expect(screen.getByRole('button', { name: /work out the nutrition/i })).toBeTruthy();
  });

  it('a failed read with no caption offers a retry, not a button that cannot work', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('nope'));
    const { user } = setupDraft();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await screen.findByRole('button', { name: /try reading it again/i });
    expect(screen.queryByRole('button', { name: /work it out/i })).toBeNull();
  });

  it('a failed read with a caption works the meal out from the caption', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('nope'));
    const { user } = setupDraft();
    await user.type(screen.getByLabelText('A few words about the photo'), 'Two slices');
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work it out from “two slices”/i }));
    await waitFor(() =>
      expect(api.previewMealFromReading).toHaveBeenCalledWith(
        expect.objectContaining({ reading: '', caption: 'Two slices' }),
      ),
    );
  });
});
