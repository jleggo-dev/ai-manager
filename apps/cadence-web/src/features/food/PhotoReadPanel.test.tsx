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

const api = { readMealPhoto: vi.fn(), logMealFromReading: vi.fn() };
vi.mock('../../lib/api.ts', () => ({
  readMealPhoto: (...a: unknown[]) => api.readMealPhoto(...a),
  logMealFromReading: (...a: unknown[]) => api.logMealFromReading(...a),
}));

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
