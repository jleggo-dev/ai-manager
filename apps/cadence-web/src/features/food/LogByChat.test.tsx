/**
 * The chat door's own line above the card (FOOD-LOGGING-COACH-LED.md): what it says depends on who
 * did the reading — a table, because each branch is one wrong `?.` away from the other.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../../components/MicButton.tsx', () => ({ MicButton: () => <button type="button">mic</button> }));
vi.mock('./MealParseCard.tsx', () => ({ MealParseCard: () => <div>the card</div> }));
vi.mock('../plan/occurrence/format.ts', () => ({ downscalePhoto: async () => 'data:image/jpeg;base64,eA==' }));
const api = vi.hoisted(() => ({ previewMeal: vi.fn() }));
vi.mock('../../lib/api.ts', () => api);

const { LogByChat } = await import('./LogByChat.tsx');
const { NOT_REACHED_CARD, READING } = await import('./coachReadCopy.ts');

const base = {
  meal: 'snack' as const,
  raw_text: 'a banana',
  items: [{ name: 'Banana, raw', qty: 1, unit: 'medium', est: { kcal: 105 } }],
  macros: { kcal: 105 },
  confidence: null,
  flags: {},
};

async function readOut(preview: unknown) {
  api.previewMeal.mockResolvedValueOnce(preview);
  render(<LogByChat meal="snack" onLogged={() => {}} onBack={() => {}} />);
  fireEvent.change(screen.getByLabelText('What did you have?'), { target: { value: 'a banana' } });
  fireEvent.click(screen.getByRole('button', { name: 'Read that' }));
  await screen.findByText('the card');
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LogByChat — the line above the card says who read it', () => {
  it.each([
    [
      'the coach could not be reached → the notice, with the card’s tap hint',
      { ...base, coach: { reached: false, calls: 1, checked: ['banana: your foods: 1 rows'] } },
      NOT_REACHED_CARD,
    ],
    [
      'the coach read it → the normal line',
      { ...base, coach: { reached: true, calls: 1, checked: [] } },
      /Here's what I found/,
    ],
    ['no coach block at all (an older server) → the normal line', base, /Here's what I found/],
  ])('%s', async (_, preview, text) => {
    await readOut(preview);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('the trace renders only from what ran: present → "Checked …", empty → nothing', async () => {
    await readOut({
      ...base,
      coach: { reached: true, calls: 1, checked: ['banana: your foods: 1 rows · USDA skipped'] },
    });
    expect(screen.getByText('Checked banana: your foods: 1 rows · USDA skipped.')).toBeInTheDocument();
    cleanup();
    await readOut({ ...base, coach: { reached: true, calls: 1, checked: [] } });
    expect(screen.queryByText(/^Checked/)).not.toBeInTheDocument();
  });

  it('says what it is doing while it reads', () => {
    api.previewMeal.mockReturnValueOnce(new Promise(() => {}));
    render(<LogByChat meal="snack" onLogged={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('What did you have?'), { target: { value: 'a banana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read that' }));
    expect(screen.getByRole('status')).toHaveTextContent(READING);
  });
});

function pickPhoto() {
  fireEvent.click(screen.getByRole('button', { name: 'Add a photo' }));
  const input = screen.getByRole('menuitem', { name: 'Take a photo' }).querySelector('input')!;
  fireEvent.change(input, { target: { files: [new File(['x'], 'plate.jpg', { type: 'image/jpeg' })] } });
}

/** Photos in every chat (owner, 2026-11-01): the camera hands the photo AND the words over. */
describe('LogByChat — the camera', () => {
  it('hands the photo to the photo read with what is typed as its caption', async () => {
    const onPhoto = vi.fn();
    render(<LogByChat meal="dinner" onLogged={() => {}} onBack={() => {}} onPhoto={onPhoto} />);
    fireEvent.change(screen.getByLabelText('What did you have?'), { target: { value: 'oat milk in it' } });
    pickPhoto();
    await vi.waitFor(() => expect(onPhoto).toHaveBeenCalledWith('data:image/jpeg;base64,eA==', 'oat milk in it'));
  });

  it('no onPhoto, no camera', () => {
    render(<LogByChat meal="dinner" onLogged={() => {}} onBack={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Add a photo' })).toBeNull();
  });
});
