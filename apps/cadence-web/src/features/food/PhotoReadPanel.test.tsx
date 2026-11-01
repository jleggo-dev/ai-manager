/**
 * What the person SEES, in order.
 *
 * The hook has its own tests; these exist because this repo has twice shipped a status line that
 * was correct in the unit and never reached the screen (PLAN.md, 2026-08-17 and 2026-08-21). So
 * every assertion here is on rendered output — the progress copy visible during the wait, the
 * reading visible before any number exists, the edited text actually leaving for the server.
 *
 * Since 2026-11-01 the confirmed reading is read the way a typed meal is (FOOD-LOGGING-COACH-LED.md,
 * build step 4), and the card under the photo is the typed door's card. So these also pin, as a
 * table, the line above it (who read it: not reached / reached / no coach block), the trace, a
 * question row asking through the chips and counting nothing, and the photo riding on the confirm.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MealPreview } from '../../lib/api.ts';

const api = { readMealPhoto: vi.fn(), previewMealFromReading: vi.fn(), logPreviewedMeal: vi.fn() };
vi.mock('../../lib/api.ts', () => ({
  readMealPhoto: (...a: unknown[]) => api.readMealPhoto(...a),
  previewMealFromReading: (...a: unknown[]) => api.previewMealFromReading(...a),
  logPreviewedMeal: (...a: unknown[]) => api.logPreviewedMeal(...a),
}));
// The card reads the day cache's invalidator.
vi.mock('../../lib/query/index.ts', () => ({ useInvalidateNutritionDay: () => vi.fn() }));

const { PhotoReadPanel } = await import('./PhotoReadPanel.tsx');
const { NOT_REACHED_CARD, FOUND_CARD } = await import('./coachReadCopy.ts');

/** The reading as the job writes it: sentences for the person, a blank line, the list. */
const READING = [
  'A tall cup with a Starbucks sleeve, a venti by its height, and a banana beside it.',
  'I cannot tell whether the milk is whole or skim.',
  '',
  '1 venti Starbucks latte',
  '1 medium banana',
].join('\n');
const WORDS = '1 venti Starbucks latte\n1 medium banana';
const PRICED: MealPreview = {
  meal: 'breakfast',
  raw_text: WORDS,
  items: [
    {
      name: 'Caffè Latte (Venti)',
      brand: 'Starbucks',
      qty: 1,
      unit: 'venti',
      est: { kcal: 250, protein_g: 16, carbs_g: 36, fat_g: 6 },
      food_id: 'f-latte',
      said: '1 venti Starbucks latte',
      basis: 'record',
      source_label: 'FatSecret',
    },
    {
      name: 'Banana, raw',
      qty: 1,
      unit: 'medium',
      est: { kcal: 105, protein_g: 1, carbs_g: 27, fat_g: 0 },
      food_id: 'f-banana',
      said: '1 medium banana',
      basis: 'record',
      source_label: 'USDA',
    },
  ],
  macros: { kcal: 355, protein_g: 17, carbs_g: 63, fat_g: 6 },
  confidence: null,
  flags: {},
  coach: { reached: true, calls: 1, checked: ['venti Starbucks latte: your foods: 1 rows', 'banana: USDA: 1 rows'] },
};
const ROW = { log_id: 'm1', meal: 'breakfast' };
const PHOTO = 'data:image/jpeg;base64,xxx';

beforeEach(() => {
  vi.clearAllMocks();
  api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: READING, error: null });
  api.previewMealFromReading.mockResolvedValue(PRICED);
  api.logPreviewedMeal.mockResolvedValue(ROW);
});

const setup = () => {
  const onLogged = vi.fn();
  render(<PhotoReadPanel photo={PHOTO} meal="breakfast" onLogged={onLogged} onBack={() => {}} />);
  return { onLogged, user: userEvent.setup() };
};

/** Read, then confirm the reading — the two taps before the card. */
async function toCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /have a look/i }));
  await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));
  await screen.findByRole('region', { name: 'Confirm meal log' });
}

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
    // The confirm is offered, and nothing has been looked up or logged yet.
    expect(screen.getByRole('button', { name: /work out the nutrition/i })).toBeTruthy();
    expect(api.previewMealFromReading).not.toHaveBeenCalled();
    expect(api.logPreviewedMeal).not.toHaveBeenCalled();
  });

  /** The correction is the entire reason for the split — it must be what leaves. */
  it('reads the EDITED reading, not the original', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    const box = await screen.findByLabelText('What the photo shows');

    await user.clear(box);
    await user.type(box, '1 venti oat milk latte');
    await user.click(screen.getByRole('button', { name: /work out the nutrition/i }));

    await waitFor(() =>
      expect(api.previewMealFromReading).toHaveBeenCalledWith(
        expect.objectContaining({ reading: '1 venti oat milk latte', meal: 'breakfast' }),
      ),
    );
  });

  /**
   * Regression: the reading block was gated on `r.reading` being non-empty, so clearing the box to
   * rewrite it unmounted the field — the person most determined to correct the reading was the one
   * it broke for.
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
  it('still offers to work the meal out from the caption when the read fails', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('nope'));
    const { user } = setup();
    await user.type(screen.getByLabelText('A few words about the photo'), 'a small latte');
    await user.click(screen.getByRole('button', { name: /have a look/i }));

    await user.click(await screen.findByRole('button', { name: /work it out from “a small latte”/i }));
    await waitFor(() =>
      expect(api.previewMealFromReading).toHaveBeenCalledWith(
        expect.objectContaining({ reading: '', caption: 'a small latte' }),
      ),
    );
  });

  it('shows the typed door’s card: her rows, their numbers and the total, before anything is logged', async () => {
    const { user } = setup();
    await toCard(user);
    expect(screen.getByRole('button', { name: 'Caffè Latte (Venti)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Banana, raw' })).toBeTruthy();
    expect(screen.getByText('~355 kcal')).toBeTruthy();
    expect(screen.getByText(FOUND_CARD)).toBeTruthy();
    expect(screen.getByText('Checked venti Starbucks latte: your foods: 1 rows; banana: USDA: 1 rows.')).toBeTruthy();
    expect(api.logPreviewedMeal).not.toHaveBeenCalled();
  });

  it('logs through the card with the photo and the reading on it, and hands the row back', async () => {
    const { user, onLogged } = setup();
    await toCard(user);
    await user.click(screen.getByRole('button', { name: 'Log to breakfast' }));

    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    const [sent, meal] = api.logPreviewedMeal.mock.calls[0] as [MealPreview, string];
    expect(meal).toBe('breakfast');
    expect(sent).toMatchObject({ photo_ref: 'ref/1.jpg', photo_reading: READING, raw_text: WORDS });
    // The coach's link and their words ride back, so the confirm prices from the food and learns.
    expect(sent.items[0]).toMatchObject({ food_id: 'f-latte', said: '1 venti Starbucks latte' });
    expect(sent.items[1]).toMatchObject({ food_id: 'f-banana', said: '1 medium banana' });
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith(ROW));
  });

  it('goes back to the reading from the numbers, to fix it and read again', async () => {
    const { user } = setup();
    await toCard(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('What the photo shows')).toBeTruthy();
    expect(screen.getByRole('button', { name: /work out the nutrition/i })).toBeTruthy();
  });
});

describe('PhotoReadPanel — the line above the card says who read it (the chat door’s table)', () => {
  it.each([
    [
      'the coach could not be reached → the notice, with the card’s tap hint',
      { ...PRICED, coach: { reached: false, calls: 1, checked: ['banana: your foods: 1 rows'] } },
      NOT_REACHED_CARD,
    ],
    ['the coach read it → the normal line', { ...PRICED, coach: { reached: true, calls: 1, checked: [] } }, FOUND_CARD],
    ['no coach block at all (an older server) → the normal line', { ...PRICED, coach: undefined }, FOUND_CARD],
  ])('%s', async (_, preview, text) => {
    api.previewMealFromReading.mockResolvedValue(preview);
    const { user } = setup();
    await toCard(user);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('the trace renders only from what ran: present → "Checked …", empty → nothing', async () => {
    api.previewMealFromReading.mockResolvedValue({
      ...PRICED,
      coach: { reached: true, calls: 1, checked: ['banana: your foods: 1 rows · USDA skipped'] },
    });
    const { user } = setup();
    await toCard(user);
    expect(screen.getByText('Checked banana: your foods: 1 rows · USDA skipped.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    api.previewMealFromReading.mockResolvedValue({ ...PRICED, coach: { reached: true, calls: 1, checked: [] } });
    await user.click(screen.getByRole('button', { name: /work out the nutrition/i }));
    await screen.findByRole('region', { name: 'Confirm meal log' });
    expect(screen.queryByText(/^Checked/)).toBeNull();
  });

  it('a row waiting on her question asks it through the chips, and counts nothing until answered', async () => {
    api.previewMealFromReading.mockResolvedValue({
      ...PRICED,
      items: [{ name: 'venti Starbucks latte', basis: 'none', question: 'Whole milk or skim?' }, PRICED.items[1]!],
      macros: { kcal: 105 },
    });
    const { user } = setup();
    await toCard(user);
    // Her question, in her words, where the plain "how much?" would otherwise be; chips, never a keypad.
    expect(screen.getByText('Whole milk or skim?')).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 glass' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '2 glasses' })).toBeTruthy();
    expect(screen.getByText('1 AMOUNT TO SETTLE')).toBeTruthy();
    // Only the banana counts, and the log waits on the answer — the typed door's gate.
    expect(screen.getByText('~105 kcal')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'One amount to settle first' })).toBeDisabled();
  });
});

/**
 * Inside an open meal (the quick log's photo door). The owner's report, 2026-10-31: the reading was
 * a markdown summary well past 500 characters, it went to the words path's preview, and every
 * photo came back "meal preview failed: 400". Then: show the numbers before adding.
 */
describe('PhotoReadPanel — draft mode', () => {
  const LONG = `Two slices of a thick pizza on a board.\n\n${Array.from({ length: 10 }, (_, i) => `${i + 1} slice Hawaiian pizza with a very long description of toppings`).join('\n')}`;
  const DRAFT_PRICED: MealPreview = {
    ...PRICED,
    meal: 'dinner',
    raw_text: '2 slice Hawaiian pizza',
    items: [
      {
        name: 'Hawaiian pizza',
        qty: 2,
        unit: 'slice',
        est: { kcal: 560, protein_g: 24, carbs_g: 66, fat_g: 21 },
        said: '2 slice Hawaiian pizza',
        basis: 'estimate',
      },
    ],
    macros: { kcal: 560, protein_g: 24, carbs_g: 66, fat_g: 21 },
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
    api.previewMealFromReading.mockResolvedValue(DRAFT_PRICED);
  });

  it('reads the whole reading on the photo route, however long it runs', async () => {
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

  it('shows the foods and their numbers BEFORE anything joins the meal, then adds the card’s rows', async () => {
    const { user, appendDraft } = setupDraft();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));

    expect(await screen.findByText('~560 kcal')).toBeTruthy();
    expect(screen.getByText(/24g protein/)).toBeTruthy();
    expect(screen.getByText(FOUND_CARD)).toBeTruthy();
    expect(appendDraft).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add to dinner' }));
    await waitFor(() => expect(appendDraft).toHaveBeenCalled());
    const [items, rawText] = appendDraft.mock.calls[0] as [MealPreview['items'], string];
    expect(rawText).toBe(DRAFT_PRICED.raw_text);
    expect(items[0]).toMatchObject({ name: 'Hawaiian pizza', qty: 2, unit: 'slice', said: '2 slice Hawaiian pizza' });
    // Nothing is logged in draft mode: the draft owns the write.
    expect(api.logPreviewedMeal).not.toHaveBeenCalled();
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
