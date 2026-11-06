/**
 * The chat door's own line above the card (FOOD-LOGGING-COACH-LED.md): what it says depends on who
 * did the reading — a table, because each branch is one wrong `?.` away from the other.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../components/MicButton.tsx', () => ({ MicButton: () => <button type="button">mic</button> }));
vi.mock('./MealParseCard.tsx', () => ({ MealParseCard: () => <div>the card</div> }));
vi.mock('../plan/occurrence/format.ts', () => ({ downscalePhoto: async () => 'data:image/jpeg;base64,eA==' }));
const api = vi.hoisted(() => ({ previewMeal: vi.fn() }));
vi.mock('../../lib/api.ts', () => api);

const { LogByChat, TRY_AGAIN } = await import('./LogByChat.tsx');
const { readReadInProgress, rememberRead } = await import('./readInProgress.ts');
const { ANOTHER_GO_CARD, NOT_REACHED_CARD, READING, STOP_READING } = await import('./coachReadCopy.ts');

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

describe('LogByChat — stopping a read', () => {
  const hanging = () =>
    api.previewMeal.mockImplementationOnce(
      (_w: string, _m: string, _c: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
        }),
    );

  it('Stop ends the read: the words go back in the box, no failure line, nothing left on the thread', async () => {
    hanging();
    render(<LogByChat meal="snack" date="2026-11-05" onLogged={() => {}} onBack={() => {}} />);
    const box = screen.getByLabelText('What did you have?');
    fireEvent.change(box, { target: { value: 'a bananna' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read that' }));
    expect(screen.getByText(READING)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Read that' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: STOP_READING }));

    await waitFor(() => expect(box).toBeEnabled());
    expect(box).toHaveValue('a bananna');
    expect(screen.queryByText(READING)).not.toBeInTheDocument();
    expect(document.querySelector('.fc-said')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read that' })).toBeEnabled();
    expect(readReadInProgress()).toBeNull();
  });

  it('stopping a correction keeps the card it was correcting', async () => {
    await readOut(base);
    hanging();
    fireEvent.change(screen.getByLabelText('What did you have?'), { target: { value: 'it was two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read that' }));
    fireEvent.click(screen.getByRole('button', { name: STOP_READING }));
    await waitFor(() => expect(screen.getByLabelText('What did you have?')).toBeEnabled());
    expect(screen.getByText('the card')).toBeInTheDocument();
    expect(screen.getByText('a banana')).toBeInTheDocument();
    expect(screen.queryByText('it was two', { selector: '.fc-said' })).not.toBeInTheDocument();
  });
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

  it('the trace renders only from what ran: present → one line with the part behind it, empty → nothing', async () => {
    await readOut({
      ...base,
      coach: { reached: true, calls: 1, checked: ['banana: your foods: 1 rows · USDA skipped'] },
    });
    expect(screen.getByText('1 part looked up · 1 call')).toBeInTheDocument();
    expect(screen.getByText('banana: your foods: 1 rows · USDA skipped')).toBeInTheDocument();
    cleanup();
    await readOut({ ...base, coach: { reached: true, calls: 1, checked: [] } });
    expect(screen.queryByText(/looked up/)).not.toBeInTheDocument();
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

/** A second message while a card is up is "not quite" (owner, 2026-11-02), never a fresh read of it alone. */
describe('LogByChat — a second message is "not quite"', () => {
  it('goes back with the same words and the card as shown, and the card that comes back replaces it', async () => {
    await readOut({ ...base, coach: { reached: true, calls: 1, checked: [] } });
    api.previewMeal.mockResolvedValueOnce({
      ...base,
      items: [{ name: 'Banana, raw', qty: 2, unit: 'medium', est: { kcal: 210 } }],
      coach: { reached: true, calls: 1, checked: [] },
    });
    fireEvent.change(screen.getByLabelText('What did you have?'), { target: { value: 'it was two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read that' }));
    await waitFor(() =>
      expect(api.previewMeal).toHaveBeenLastCalledWith(
        'a banana',
        'snack',
        { words: 'it was two', previous: ['Banana, raw, 1 medium'] },
        expect.objectContaining({ resume: false }),
      ),
    );
    expect(await screen.findByText(ANOTHER_GO_CARD)).toBeInTheDocument();
    expect(screen.getByText('it was two')).toBeInTheDocument();
    expect(screen.getByText('a banana')).toBeInTheDocument();
  });

  it('a failed read says what happened in the thread, keeps the words, and offers Try again', async () => {
    api.previewMeal.mockRejectedValueOnce(Object.assign(new Error('500'), { status: 500 }));
    render(<LogByChat meal="snack" onLogged={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('What did you have?'), { target: { value: 'a banana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read that' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/my side/);
    expect(screen.getByLabelText('What did you have?')).toHaveValue('a banana');
    expect(screen.getByRole('button', { name: TRY_AGAIN })).toBeEnabled();
  });
});

/**
 * The read the app was relaunched in the middle of (readInProgress.ts, owner 2026-11-03): the chat
 * door reopens with the words said, asks after the answer under the remembered id — the correction
 * too, when the read was a "not quite" — and forgets the record once the card is up.
 */
describe('LogByChat — a read remembered for a relaunch', () => {
  it('reopened on a "not quite" re-read: the same words and correction go back under the remembered id', async () => {
    const inFlight = {
      door: 'chat' as const,
      meal: 'snack' as const,
      date: '2026-11-03',
      requestId: '3f2c9b1e-4d5a-4c6b-8e7f-1a2b3c4d5e6f',
      kind: 'words' as const,
      words: 'a banana',
      correction: { words: 'it was a big one', previous: ['Banana, raw, 1 medium'] },
    };
    api.previewMeal.mockResolvedValueOnce({ ...base, coach: { reached: true, calls: 1, checked: [] } });
    rememberRead(inFlight);
    render(<LogByChat meal="snack" date="2026-11-03" resume={inFlight} onLogged={() => {}} onBack={() => {}} />);
    await screen.findByText('the card');
    expect(api.previewMeal).toHaveBeenCalledTimes(1);
    expect(api.previewMeal).toHaveBeenCalledWith('a banana', 'snack', inFlight.correction, {
      requestId: inFlight.requestId,
      resume: true,
      signal: expect.any(AbortSignal),
    });
    expect(screen.getByText('a banana')).toBeInTheDocument();
    expect(screen.getByText('it was a big one')).toBeInTheDocument();
    expect(readReadInProgress()).toBeNull();
  });

  it('a fresh read inside a dated meal is remembered under its id while it runs', async () => {
    let release!: (v: unknown) => void;
    api.previewMeal.mockReturnValueOnce(new Promise((r) => (release = r)));
    render(<LogByChat meal="snack" date="2026-11-03" onLogged={() => {}} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText('What did you have?'), { target: { value: 'a banana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read that' }));
    await waitFor(() => expect(readReadInProgress()).toMatchObject({ door: 'chat', words: 'a banana' }));
    release({ ...base, coach: { reached: true, calls: 1, checked: [] } });
    await screen.findByText('the card');
    expect(readReadInProgress()).toBeNull();
  });
});
