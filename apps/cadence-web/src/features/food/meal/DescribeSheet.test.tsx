/**
 * The quick-log "What did you have?" sheet: the same read as the chat door, listed as rows with no
 * tap-to-edit — so its not-reached notice must not promise one — and a row waiting on the coach's
 * question is shown as the question and left out of the button's total.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../components/MicButton.tsx', () => ({ MicButton: () => <button type="button">mic</button> }));
vi.mock('../../../components/CoachFace.tsx', () => ({ CoachFace: () => <span /> }));
vi.mock('../../plan/occurrence/format.ts', () => ({ downscalePhoto: async () => 'data:image/jpeg;base64,eA==' }));
const api = vi.hoisted(() => ({ previewMeal: vi.fn(), previewMealAnswer: vi.fn() }));
vi.mock('../../../lib/api.ts', () => api);

const { DescribeSheet } = await import('./DescribeSheet.tsx');
const { NOT_REACHED } = await import('../coachReadCopy.ts');
const { CHECK_FAILED, CHECKING } = await import('../MealQuestionChoices.tsx');
const { COULD_NOT_SETTLE } = await import('../MealAskedRow.tsx');
const { NOT_REACHED_ANSWER } = await import('../coachReadCopy.ts');

const base = {
  meal: 'snack' as const,
  raw_text: 'a banana',
  items: [{ name: 'Banana, raw', qty: 1, unit: 'medium', est: { kcal: 105 } }],
  macros: { kcal: 105 },
  confidence: null,
  flags: {},
};

async function lookUp(preview: unknown) {
  api.previewMeal.mockResolvedValueOnce(preview);
  render(<DescribeSheet meal="snack" seed="a banana" onAdd={async () => true} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
  await screen.findByText('Banana, raw');
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DescribeSheet — who read it, and what the rows say', () => {
  it.each([
    [
      'the coach could not be reached → the notice alone, no tap hint (these rows do not open an editor)',
      { ...base, coach: { reached: false, calls: 1, checked: [] } },
      NOT_REACHED,
    ],
    [
      'the coach read it → "Here\'s what I found"',
      { ...base, coach: { reached: true, calls: 1, checked: [] } },
      "Here's what I found",
    ],
    ['no coach block at all → "Here\'s what I found"', base, "Here's what I found"],
  ])('%s', async (_, preview, text) => {
    await lookUp(preview);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/Tap a row/)).not.toBeInTheDocument();
  });

  it('the trace renders only from what ran', async () => {
    await lookUp({ ...base, coach: { reached: true, calls: 1, checked: ['banana: your foods: 1 rows'] } });
    expect(screen.getByText('Checked banana: your foods: 1 rows.')).toBeInTheDocument();
    cleanup();
    await lookUp({ ...base, coach: { reached: true, calls: 1, checked: [] } });
    expect(screen.queryByText(/^Checked/)).not.toBeInTheDocument();
  });

  it('a question row that arrives WITH a number is still left out of the total', async () => {
    await lookUp({
      ...base,
      items: [{ name: 'milk', question: 'Whole milk or 2%?', est: { kcal: 122 } }, ...base.items],
      coach: { reached: true, calls: 1, checked: [] },
    });
    expect(screen.getByRole('button', { name: /Looks right · 105 kcal/ })).toBeInTheDocument();
  });

  it('not reached, with a trace: the notice and the trace both show', async () => {
    await lookUp({ ...base, coach: { reached: false, calls: 1, checked: ['banana: your foods: 1 rows'] } });
    expect(screen.getByText(NOT_REACHED)).toBeInTheDocument();
    expect(screen.getByText('Checked banana: your foods: 1 rows.')).toBeInTheDocument();
  });

  it('a row waiting on her question shows the question, asks the amount, and is not in the total', async () => {
    await lookUp({
      ...base,
      items: [{ name: 'milk', question: 'Whole milk or 2%?' }, ...base.items],
      coach: { reached: true, calls: 1, checked: [] },
    });
    expect(screen.getByText('Whole milk or 2%?')).toBeInTheDocument();
    expect(screen.getByText('how much?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Looks right · 105 kcal/ })).toBeInTheDocument();
  });
});

/**
 * Her question answered from the sheet (FOOD-LOGGING-COACH-LED.md, "chips in her voice"): the
 * same buttons as the confirm card, a tap re-reads the part for this sheet's slot, and the priced
 * row takes the asked row's place — in the list and in the button's total.
 */
describe('DescribeSheet — her question answered with a button', () => {
  const askedRow = {
    name: 'milk',
    question: 'Whole milk, 2% or skim?',
    choices: ['Whole milk', '2%', 'Skim'],
    asked_about: 'milk',
  };
  const whole = {
    ...base,
    raw_text: 'whole milk',
    items: [{ name: 'Milk, whole', qty: 1, unit: 'cup', est: { kcal: 149 }, food_id: 'f-whole', said: 'whole milk' }],
    macros: { kcal: 149 },
  };

  it('offers her answers as buttons under the row, and holds the add until it is answered', async () => {
    await lookUp({ ...base, items: [askedRow, ...base.items], coach: { reached: true, calls: 1, checked: [] } });
    for (const name of ['Whole milk', '2%', 'Skim', 'Something else']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByText(/Whole milk, 2% or skim\?/)).toBeInTheDocument();
    // The add would strip the question (the draft keeps none of question/choices): it waits.
    expect(screen.getByRole('button', { name: 'One question to settle first' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Looks right/ })).not.toBeInTheDocument();
  });

  it('a tap re-reads the part for this slot and the priced row takes its place, total included', async () => {
    await lookUp({ ...base, items: [askedRow, ...base.items], coach: { reached: true, calls: 1, checked: [] } });
    api.previewMealAnswer.mockResolvedValueOnce(whole);
    fireEvent.click(screen.getByRole('button', { name: 'Whole milk' }));
    await waitFor(() =>
      expect(api.previewMealAnswer).toHaveBeenCalledWith({
        asked_about: 'milk',
        answer: 'Whole milk',
        chosen: true,
        meal: 'snack',
      }),
    );
    expect(await screen.findByText('Milk, whole')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Whole milk' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Looks right · 254 kcal/ })).toBeInTheDocument();
  });

  it('a failed re-read says so and keeps the buttons', async () => {
    await lookUp({ ...base, items: [askedRow, ...base.items], coach: { reached: true, calls: 1, checked: [] } });
    api.previewMealAnswer.mockRejectedValueOnce(new Error('500'));
    fireEvent.click(screen.getByRole('button', { name: 'Skim' }));
    expect(await screen.findByText(CHECK_FAILED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skim' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'One question to settle first' })).toBeDisabled();
  });

  it('near-miss: a question row without choices offers no buttons, and does not hold the add', async () => {
    await lookUp({
      ...base,
      items: [{ name: 'milk', question: 'How much?', asked_about: 'milk' }, ...base.items],
      coach: { reached: true, calls: 1, checked: [] },
    });
    expect(screen.queryByRole('button', { name: 'Something else' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Looks right · 105 kcal/ })).toBeEnabled();
  });

  it('while an answer runs, the drops and the add wait; the answer lands on its own row', async () => {
    await lookUp({ ...base, items: [askedRow, ...base.items], coach: { reached: true, calls: 1, checked: [] } });
    let settle!: (p: unknown) => void;
    api.previewMealAnswer.mockReturnValueOnce(new Promise((r) => (settle = r)));
    fireEvent.click(screen.getByRole('button', { name: '2%' }));
    expect(await screen.findByText(CHECKING)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drop Banana, raw' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Drop milk' })).toBeDisabled();
    settle(whole);
    expect(await screen.findByText('Milk, whole')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drop Banana, raw' })).toBeEnabled();
    const rows = screen.getAllByRole('button', { name: /^Drop / }).map((b) => b.getAttribute('aria-label'));
    expect(rows).toEqual(['Drop Milk, whole', 'Drop Banana, raw']);
  });

  it('an answer the coach could not read says so, and its row says it is an automatic estimate', async () => {
    await lookUp({ ...base, items: [askedRow, ...base.items], coach: { reached: true, calls: 1, checked: [] } });
    api.previewMealAnswer.mockResolvedValueOnce({
      ...whole,
      items: [{ ...whole.items[0], food_id: undefined, basis: 'fallback', source_label: 'an automatic estimate' }],
      coach: { reached: false, calls: 1, checked: [] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Whole milk' }));
    expect(await screen.findByText(NOT_REACHED_ANSWER)).toBeInTheDocument();
    // Twice: the notice, and the row's own line (the sheet draws kcal in its own column, so the
    // line is the label alone for a row with no protein, carbs or fat).
    const said = screen.getAllByText(/an automatic estimate/).map((el) => el.textContent);
    expect(said.sort()).toEqual([NOT_REACHED_ANSWER, 'an automatic estimate'].sort());
  });

  it('a question that comes back twice stops offering buttons, says why, and no longer holds the add', async () => {
    await lookUp({ ...base, items: [askedRow, ...base.items], coach: { reached: true, calls: 1, checked: [] } });
    api.previewMealAnswer.mockResolvedValue({ ...base, items: [{ ...askedRow, name: 'whole milk' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Whole milk' }));
    await waitFor(() => expect(api.previewMealAnswer).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Whole milk' }));
    expect(await screen.findByText(new RegExp(COULD_NOT_SETTLE.slice(0, 30)))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Something else' })).not.toBeInTheDocument();
    // An amount question now: it waits on the drawer, as an open amount always has.
    expect(screen.getByRole('button', { name: /Looks right · 105 kcal/ })).toBeEnabled();
    api.previewMealAnswer.mockReset();
  });
});

function pickPhoto() {
  fireEvent.click(screen.getByRole('button', { name: 'Add a photo' }));
  const input = screen.getByRole('menuitem', { name: 'Take a photo' }).querySelector('input')!;
  fireEvent.change(input, { target: { files: [new File(['x'], 'plate.jpg', { type: 'image/jpeg' })] } });
}

/** Photos in every chat (owner, 2026-11-01): the camera hands the photo AND the words over. */
describe('DescribeSheet — the camera', () => {
  it('hands the photo to the photo read with what is typed as its caption', async () => {
    const onPhoto = vi.fn();
    render(
      <DescribeSheet meal="lunch" seed="the small one" onAdd={async () => true} onClose={() => {}} onPhoto={onPhoto} />,
    );
    pickPhoto();
    await vi.waitFor(() => expect(onPhoto).toHaveBeenCalledWith('data:image/jpeg;base64,eA==', 'the small one'));
  });

  it('no onPhoto, no camera', () => {
    render(<DescribeSheet meal="lunch" onAdd={async () => true} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Add a photo' })).toBeNull();
  });
});
