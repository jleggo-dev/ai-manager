/**
 * What the person SEES, in order.
 *
 * The hook has its own tests; these exist because this repo has twice shipped a status line that
 * was correct in the unit and never reached the screen (PLAN.md, 2026-08-17 and 2026-08-21). So
 * every assertion here is on rendered output — the progress copy visible during the wait, the
 * reading visible before any number exists, the edited text actually leaving for the server.
 *
 * Since 2026-11-01 the confirmed reading is read the way a typed meal is (FOOD-LOGGING-COACH-LED.md,
 * build step 4), and the card under the photo is the typed door's card. So these also pin, as
 * tables: the line above it (who read it: not reached / reached / no coach block, with and without
 * a trace), the lines not read, a question row asking through the chips and counting nothing, the
 * photo riding on the confirm, and — review of #457 — every fault phase's words and buttons, in
 * plain language with a way forward, and Back never disabled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
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
const { HERE_IS, READ_FAILED, NO_FOODS, WORK_OUT_FAILED } = await import('./photoReadCopy.ts');

/** The reading as the job writes it: sentences for the person, a blank line, the list. */
const READING = [
  'A tall cup with a Starbucks sleeve, a venti by its height, and a banana beside it.',
  'I cannot tell whether the milk is whole or skim.',
  '',
  '1 venti Starbucks latte',
  '1 medium banana',
].join('\n');
const WORDS = '1 venti Starbucks latte\n1 medium banana';
const LATTE: MealPreview['items'][number] = {
  name: 'Caffè Latte (Venti)',
  brand: 'Starbucks',
  qty: 1,
  unit: 'venti',
  est: { kcal: 250, protein_g: 16, carbs_g: 36, fat_g: 6 },
  food_id: 'f-latte',
  said: '1 venti Starbucks latte',
  basis: 'record',
  source_label: 'FatSecret',
};
const BANANA: MealPreview['items'][number] = {
  name: 'Banana, raw',
  qty: 1,
  unit: 'medium',
  est: { kcal: 105, protein_g: 1, carbs_g: 27, fat_g: 0 },
  food_id: 'f-banana',
  said: '1 medium banana',
  basis: 'record',
  source_label: 'USDA',
};
const PRICED: MealPreview = {
  meal: 'breakfast',
  raw_text: WORDS,
  items: [LATTE, BANANA],
  macros: { kcal: 355, protein_g: 17, carbs_g: 63, fat_g: 6 },
  confidence: null,
  flags: {},
  coach: { reached: true, calls: 1, checked: ['venti Starbucks latte: your foods: 1 rows', 'banana: USDA: 1 rows'] },
};
const ROW = { log_id: 'm1', meal: 'breakfast' };
const PHOTO = 'data:image/jpeg;base64,xxx';
const anyOpts = expect.objectContaining({ signal: expect.anything() });

beforeEach(() => {
  vi.clearAllMocks();
  api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: READING, error: null });
  api.previewMealFromReading.mockResolvedValue(PRICED);
  api.logPreviewedMeal.mockResolvedValue(ROW);
});
afterEach(cleanup);

const setup = (caption?: string) => {
  const onLogged = vi.fn();
  const onBack = vi.fn();
  render(
    <PhotoReadPanel photo={PHOTO} meal="breakfast" onLogged={onLogged} onBack={onBack} initialCaption={caption} />,
  );
  return { onLogged, onBack, user: userEvent.setup() };
};

/** Read, then confirm the reading — the two taps before the card. */
async function toCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /have a look/i }));
  await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));
  await screen.findByRole('region', { name: 'Confirm meal log' });
}

const buttons = () => screen.getAllByRole('button').map((b) => b.textContent?.trim());

describe('PhotoReadPanel', () => {
  /** The caption is evidence the photo cannot give, so it must reach stage 1 — not stage 2. */
  it('sends the caption to the READ, where the eyes can use it', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('A few words about the photo'), 'a small latte');
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    expect(api.readMealPhoto).toHaveBeenCalledWith(PHOTO, 'a small latte', anyOpts);
  });

  it('shows the reading on screen before any number is computed', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));

    await waitFor(() => expect(screen.getByLabelText('What the photo shows')).toBeTruthy());
    expect((screen.getByLabelText('What the photo shows') as HTMLTextAreaElement).value).toBe(READING);
    expect(screen.getByText(HERE_IS)).toBeTruthy();
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
        anyOpts,
      ),
    );
  });

  /**
   * Regression: the reading block was gated on `r.reading` being non-empty, so clearing the box to
   * rewrite it unmounted the field — the person most determined to correct the reading was the one
   * it broke for. An emptied box offers the caption instead of a confirm that cannot work.
   */
  it('keeps the box on screen when it is cleared, and offers the caption in place of the confirm', async () => {
    const { user } = setup('a small latte');
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    const box = await screen.findByLabelText('What the photo shows');
    await user.clear(box);
    expect(screen.getByLabelText('What the photo shows')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /work out the nutrition/i })).toBeNull();
    expect(screen.getByRole('button', { name: /work it out from “a small latte”/i })).toBeTruthy();
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

  it('the card’s confirm failing says so in the house words, and hands nothing back', async () => {
    api.logPreviewedMeal.mockRejectedValue(new Error('500'));
    const { user, onLogged } = setup();
    await toCard(user);
    await user.click(screen.getByRole('button', { name: 'Log to breakfast' }));
    expect(await screen.findByText("Couldn't write that down just now — try again in a moment.")).toBeTruthy();
    expect(onLogged).not.toHaveBeenCalled();
    // The card is still there to try again from.
    expect(screen.getByRole('button', { name: 'Log to breakfast' })).toBeTruthy();
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
      { ...PRICED, coach: { reached: false, calls: 1, checked: [] } },
      NOT_REACHED_CARD,
    ],
    ['the coach read it → the normal line', { ...PRICED, coach: { reached: true, calls: 1, checked: [] } }, FOUND_CARD],
    ['no coach block at all (an older server) → the normal line', { ...PRICED, coach: undefined }, FOUND_CARD],
  ])('%s', async (_, preview, text) => {
    api.previewMealFromReading.mockResolvedValue(preview);
    const { user } = setup();
    await toCard(user);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByText(/^Checked/)).toBeNull();
  });

  it('not reached WITH a trace → the notice and the trace, both', async () => {
    api.previewMealFromReading.mockResolvedValue({
      ...PRICED,
      coach: { reached: false, calls: 1, checked: ['banana: your foods: 1 rows'] },
    });
    const { user } = setup();
    await toCard(user);
    expect(screen.getByText(NOT_REACHED_CARD)).toBeTruthy();
    expect(screen.getByText('Checked banana: your foods: 1 rows.')).toBeTruthy();
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

  it('a line that was not read is said, in their words; nothing left out → nothing said', async () => {
    api.previewMealFromReading.mockResolvedValue({
      ...PRICED,
      coach: { ...PRICED.coach!, not_read: ["Let me know if you'd like changes."] },
    });
    const { user } = setup();
    await toCard(user);
    expect(screen.getByText("Not read: Let me know if you'd like changes.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    api.previewMealFromReading.mockResolvedValue(PRICED);
    await user.click(screen.getByRole('button', { name: /work out the nutrition/i }));
    await screen.findByRole('region', { name: 'Confirm meal log' });
    expect(screen.queryByText(/^Not read/)).toBeNull();
  });

  it('a row waiting on her question asks it through the chips, and counts nothing until answered', async () => {
    api.previewMealFromReading.mockResolvedValue({
      ...PRICED,
      items: [{ name: 'venti Starbucks latte', basis: 'none', question: 'Whole milk or skim?' }, BANANA],
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

  it('answering the chip and confirming posts no link and no words for the question row', async () => {
    api.previewMealFromReading.mockResolvedValue({
      ...PRICED,
      items: [{ name: 'venti Starbucks latte', basis: 'none', question: 'Whole milk or skim?' }, BANANA],
      macros: { kcal: 105 },
    });
    const { user } = setup();
    await toCard(user);
    await user.click(screen.getByRole('button', { name: '1 glass' }));
    await user.click(screen.getByRole('button', { name: 'Log to breakfast' }));
    await waitFor(() => expect(api.logPreviewedMeal).toHaveBeenCalled());
    const [sent] = api.logPreviewedMeal.mock.calls[0] as [MealPreview];
    expect(sent.items[0]).toMatchObject({ name: 'venti Starbucks latte', qty: 1, unit: 'glass' });
    expect(sent.items[0]).not.toHaveProperty('food_id');
    expect(sent.items[0]).not.toHaveProperty('said');
    expect(sent.items[1]).toMatchObject({ food_id: 'f-banana', said: '1 medium banana' });
  });

  it('near-miss: a question row WITH a number is out of the total until a chip answers it, then in', async () => {
    api.previewMealFromReading.mockResolvedValue({
      ...PRICED,
      items: [{ name: 'milk', question: 'Whole milk or skim?', est: { kcal: 122 } }, BANANA],
      macros: { kcal: 227 },
    });
    const { user } = setup();
    await toCard(user);
    expect(screen.getByText('~105 kcal')).toBeTruthy();
    expect(screen.queryByText('~227 kcal')).toBeNull();
    await user.click(screen.getByRole('button', { name: '1 glass' }));
    // Answered: the row's number is what the confirm posts, so the total says so too.
    expect(screen.getByText('~227 kcal')).toBeTruthy();
  });
});

/**
 * Every fault phase, as a table: what is said (plain words, never an API string) and which buttons
 * offer a way forward. Back is never disabled.
 */
describe('PhotoReadPanel — faults, in plain words, with a way forward', () => {
  it('the read throws (with a caption) → the kind words, the caption fallback, a retry, Back', async () => {
    api.readMealPhoto.mockRejectedValue(Object.assign(new Error('photo read failed: 500'), { status: 500 }));
    const { user } = setup('a small latte');
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    expect(await screen.findByText(READ_FAILED)).toBeTruthy();
    expect(screen.queryByText(/failed: 500/)).toBeNull();
    expect(buttons()).toEqual(['Work it out from “a small latte”', 'Try reading it again', 'Back']);
    await user.click(screen.getByRole('button', { name: /work it out from/i }));
    await waitFor(() =>
      expect(api.previewMealFromReading).toHaveBeenCalledWith(
        expect.objectContaining({ reading: '', caption: 'a small latte' }),
        anyOpts,
      ),
    );
  });

  it('the read throws (no caption) → the kind words, a retry, Back — never a button that cannot work', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('nope'));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    expect(await screen.findByText(READ_FAILED)).toBeTruthy();
    expect(buttons()).toEqual(['Try reading it again', 'Back']);
  });

  it('the eyes answer but could not read it (a 200 with error) → the box opens empty under the kind words', async () => {
    api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: '', error: 'Error: no food visible' });
    const { user } = setup('a small latte');
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    const box = await screen.findByLabelText('What the photo shows');
    expect((box as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText(READ_FAILED)).toBeTruthy();
    expect(screen.queryByText(HERE_IS)).toBeNull();
    expect(screen.queryByText(/no food visible/)).toBeNull();
    expect(buttons()).toEqual(['Work it out from “a small latte”', 'Try reading it again', 'Back']);
    // Typing what it was turns the caption fallback into the confirm.
    await user.type(box, '1 small latte');
    expect(screen.getByRole('button', { name: /work out the nutrition/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /work it out from/i })).toBeNull();
  });

  it('working it out fails → the kind words, and "Back to the reading" keeps every correction', async () => {
    api.previewMealFromReading.mockRejectedValue(Object.assign(new Error('meal preview failed: 500'), { status: 500 }));
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    const box = await screen.findByLabelText('What the photo shows');
    await user.clear(box);
    await user.type(box, '1 venti oat milk latte');
    await user.click(screen.getByRole('button', { name: /work out the nutrition/i }));
    expect(await screen.findByText(WORK_OUT_FAILED)).toBeTruthy();
    expect(screen.queryByText(/failed: 500/)).toBeNull();
    expect(buttons()).toEqual(['Back to the reading', 'Back']);
    await user.click(screen.getByRole('button', { name: 'Back to the reading' }));
    expect((screen.getByLabelText('What the photo shows') as HTMLTextAreaElement).value).toBe('1 venti oat milk latte');
    expect(api.readMealPhoto).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 400 (nothing read as a food)', Object.assign(new Error('meal preview failed: 400'), { status: 400 })],
    ['an empty card', null],
  ])('%s → the no-foods words, never the status', async (_, fault) => {
    if (fault) api.previewMealFromReading.mockRejectedValue(fault);
    else api.previewMealFromReading.mockResolvedValue({ ...PRICED, items: [] });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));
    expect(await screen.findByText(NO_FOODS)).toBeTruthy();
    expect(screen.queryByText(/400/)).toBeNull();
    expect(buttons()).toEqual(['Back to the reading', 'Back']);
  });

  it('Back stays enabled while the read runs, and leaving aborts it', async () => {
    let signal: AbortSignal | undefined;
    api.readMealPhoto.mockImplementation(
      (_p: string, _c: string, opts: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal = opts.signal;
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
        }),
    );
    const { user, onBack } = setup();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await screen.findByText('Sending your photo…');
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toBeEnabled();
    await user.click(back);
    expect(onBack).toHaveBeenCalled();
    expect(signal?.aborted).toBe(true);
  });
});

/**
 * Inside an open meal (the quick log's photo door — the one live host). The owner's report,
 * 2026-10-31: the reading was a markdown summary well past 500 characters, it went to the words
 * path's preview, and every photo came back "meal preview failed: 400". Then: show the numbers
 * before adding. Since the review of #457: the photo and its reading go to the meal with the rows.
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
        anyOpts,
      ),
    );
    expect(LONG.length).toBeGreaterThan(500);
  });

  it('shows the foods BEFORE anything joins the meal, then adds the rows AND the photo with its reading', async () => {
    const { user, appendDraft } = setupDraft();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work out the nutrition/i }));

    expect(await screen.findByText('~560 kcal')).toBeTruthy();
    expect(screen.getByText(/24g protein/)).toBeTruthy();
    expect(screen.getByText(FOUND_CARD)).toBeTruthy();
    expect(appendDraft).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Add to dinner' }));
    await waitFor(() => expect(appendDraft).toHaveBeenCalled());
    const [items, rawText, photo] = appendDraft.mock.calls[0] as [
      MealPreview['items'],
      string,
      { photo_ref?: string; photo_reading?: string },
    ];
    expect(rawText).toBe(DRAFT_PRICED.raw_text);
    expect(items[0]).toMatchObject({ name: 'Hawaiian pizza', qty: 2, unit: 'slice', said: '2 slice Hawaiian pizza' });
    expect(photo).toEqual({ photo_ref: 'ref/1.jpg', photo_reading: LONG });
    // Nothing is logged in draft mode: the draft owns the write.
    expect(api.logPreviewedMeal).not.toHaveBeenCalled();
  });

  it("a row waiting on the coach's question offers her answers as buttons on the photo card too", async () => {
    api.previewMealFromReading.mockResolvedValueOnce({
      ...DRAFT_PRICED,
      items: [
        {
          name: 'milk',
          question: 'Whole milk, 2% or skim?',
          choices: ['Whole milk', '2%', 'Skim'],
          asked_about: 'milk',
          basis: 'none',
        },
        ...DRAFT_PRICED.items,
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

  it('a failed read with no caption offers a retry, not a button that cannot work', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('nope'));
    const { user } = setupDraft();
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await screen.findByRole('button', { name: /try reading it again/i });
    expect(screen.queryByRole('button', { name: /work it out/i })).toBeNull();
  });

  it('a failed read with a caption works the meal out from the caption, and the add carries no photo reading', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('nope'));
    const { user, appendDraft } = setupDraft();
    await user.type(screen.getByLabelText('A few words about the photo'), 'Two slices');
    await user.click(screen.getByRole('button', { name: /have a look/i }));
    await user.click(await screen.findByRole('button', { name: /work it out from “two slices”/i }));
    await waitFor(() =>
      expect(api.previewMealFromReading).toHaveBeenCalledWith(
        expect.objectContaining({ reading: '', caption: 'Two slices' }),
        anyOpts,
      ),
    );
    await user.click(await screen.findByRole('button', { name: 'Add to dinner' }));
    await waitFor(() => expect(appendDraft).toHaveBeenCalled());
    // The read never ran, so there is no photo_ref to point at and no reading to keep.
    expect(appendDraft.mock.calls[0]?.[2]).toEqual({});
  });
});
