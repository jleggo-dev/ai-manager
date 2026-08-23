/**
 * REGRESSION (2026-08-22, owner-reported). The plan's photo path parsed and logged in one shot —
 * no reading shown, no chance to correct — which is how a pack of dill-pickle-SEASONED peanuts
 * became two foods, one of them invented. It now renders the same read-then-confirm panel the
 * Food tab uses.
 *
 * What these pin: a photo can no longer reach a row without passing through the read, and the
 * words already typed are carried in rather than dropped.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const api = vi.hoisted(() => ({
  readMealPhoto: vi.fn(async () => ({ photo_ref: 'r1', reading: 'a pack of peanuts', error: null })),
  logMealFromReading: vi.fn(async () => ({ log_id: 'l1' })),
  logMeal: vi.fn(),
}));
vi.mock('../../../lib/api.ts', () => api);
vi.mock('../../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => vi.fn(),
  localTodayIso: () => '2026-08-22',
}));

const { MealCapturePhoto } = await import('./MealCapturePhoto.tsx');

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQ';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderIt(caption = '') {
  return render(
    <MealCapturePhoto
      photo={PHOTO}
      caption={caption}
      mealKind="lunch"
      advising={false}
      advice={null}
      onClear={() => {}}
      onAskRead={() => {}}
      onLogged={() => {}}
    />,
  );
}

describe('MealCapturePhoto', () => {
  it('offers a read instead of logging straight away', () => {
    renderIt();
    expect(screen.getByRole('button', { name: /Have a look at this/ })).toBeInTheDocument();
    // The one-shot button is gone: a photo cannot reach a row without passing the read.
    expect(screen.queryByRole('button', { name: /^Log lunch$/ })).not.toBeInTheDocument();
  });

  it('never logs a photo without going through the read', () => {
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /Have a look at this/ }));
    expect(api.logMeal).not.toHaveBeenCalled();
    expect(api.readMealPhoto).toHaveBeenCalledWith(PHOTO, '');
  });

  it('carries words typed before the photo in as the caption', () => {
    renderIt('dill pickle seasoned peanuts, half the 71g pack');
    fireEvent.click(screen.getByRole('button', { name: /Have a look at this/ }));
    expect(api.readMealPhoto).toHaveBeenCalledWith(PHOTO, 'dill pickle seasoned peanuts, half the 71g pack');
  });

  it('still offers the pre-eat read, which writes nothing', () => {
    renderIt();
    expect(screen.getByRole('button', { name: /Want a read before you eat/ })).toBeInTheDocument();
  });
});
