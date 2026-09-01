/**
 * Press-level hardening for the ＋ sheet's screen-1 surfaces QuickAddSheet.test.tsx doesn't reach:
 * the scrim, the screen-1 free line, the weight row's open→unit-toggle→submit chain, and the photo
 * row's file-input→downscale→upload chain. Every case here presses the control and asserts the
 * exact wire call (owner's mandate, W2-C) — mount-only assertions belong to the other file.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const usePlan = vi.fn();
const useNutritionDay = vi.fn();
const uploadMutateAsync = vi.fn(async (..._a: unknown[]): Promise<string | null> => 'photo-1');
vi.mock('../../../lib/query/index.ts', () => ({
  usePlan: () => usePlan(),
  useNutritionDay: () => useNutritionDay(),
  useInvalidateNutritionDay: () => vi.fn(),
  useUploadProgressPhoto: () => ({ mutateAsync: (...a: unknown[]) => uploadMutateAsync(...a), isPending: false }),
}));

const logAdhoc = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
const logWater = vi.fn(async (..._a: unknown[]) => 750);
const recordWeighInToday = vi.fn(async (..._a: unknown[]) => ({ weight_kg: 88 }));
const getUnits = vi.fn(async (..._a: unknown[]) => null as unknown);
const getProgressPhotosStatus = vi.fn(async (..._a: unknown[]) => ({ enabled: false, count: 0, next_due: null }));
// The sheet's own lifted now-menu fetch (device-test fix, 2026-09-01) — drives the "Calming
// techniques" row and the pill's pinned-item suppression. Empty by default so neither is ever in
// play here; every test in this file is about its own button, not the calming sub-screen.
const getNowMenu = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('../../../lib/api.ts', () => ({
  logAdhoc: (...a: unknown[]) => logAdhoc(...a),
  logWater: (...a: unknown[]) => logWater(...a),
  recordWeighInToday: (...a: unknown[]) => recordWeighInToday(...a),
  getUnits: (...a: unknown[]) => getUnits(...a),
  getProgressPhotosStatus: (...a: unknown[]) => getProgressPhotosStatus(...a),
  getNowMenu: (...a: unknown[]) => getNowMenu(...a),
  // Wave 2 (pill + shelf) landed under this sweep: the sheet reads routines and can play one.
  // Empty/never-called defaults keep every press test here about its own button.
  getRoutines: async () => [],
  getRoutineSession: async () => ({ ok: true, session: null }),
  logDid: async () => ({ ok: true }),
}));

const downscalePhoto = vi.fn(async (..._a: unknown[]) => 'data:image/jpeg;base64,AAA');
vi.mock('../occurrence/format.ts', () => ({ downscalePhoto: (...a: unknown[]) => downscalePhoto(...a) }));

// DoNowSection is no longer mocked here: since the device-test fix it's only ever instantiated
// inside the "Calming techniques" sub-screen, which nothing in this file opens (`getNowMenu`
// resolves empty above), so it never renders regardless — mocking it would be dead weight.

const { QuickAddSheet } = await import('./QuickAddSheet.tsx');

const weighActivity = {
  activity_id: 'w1',
  title: 'Weigh-in',
  kind: 'system',
  cadence: 'daily',
  recurrence: '',
  area: 'movement',
};

const basePlan = (activities: unknown[] = [], week: unknown[] = []) => ({
  hasPlan: true,
  stage: 'committed',
  activities,
  week,
  consistency: { kept: 0, window: 7 },
});

function mount(
  state: { plan?: unknown; day?: unknown } = {},
  props: Partial<{ onClose: () => void; onLogged: () => void }> = {},
) {
  usePlan.mockReturnValue({ data: state.plan ?? basePlan(), error: null });
  useNutritionDay.mockReturnValue({ data: state.day ?? null });
  return render(<QuickAddSheet onClose={props.onClose ?? (() => {})} onLogged={props.onLogged ?? (() => {})} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuickAddSheet — scrim and the free line', () => {
  it('tapping the scrim closes the sheet', async () => {
    const onClose = vi.fn();
    const { container } = mount({}, { onClose });
    fireEvent.click(container.querySelector('.sheet-scrim')!);
    expect(onClose).toHaveBeenCalled();
  });

  it('the screen-1 free line logs exactly the typed text, with no date or area — then logs and closes', async () => {
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount({}, { onLogged, onClose });
    fireEvent.change(screen.getByPlaceholderText('Something else you did…'), {
      target: { value: 'stretched for ten minutes' },
    });
    fireEvent.click(screen.getByText('Log'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('stretched for ten minutes'));
    // Only ONE argument — the sheet's own free line never tags a date or area (that's screen 2's job).
    expect(logAdhoc.mock.calls[0]).toEqual(['stretched for ten minutes']);
    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    // logged, then closed — not the other way around.
    expect(onLogged.mock.invocationCallOrder[0]!).toBeLessThan(onClose.mock.invocationCallOrder[0]!);
  });

  it('pressing Enter in the free line logs the same way a click on Log does', async () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText('Something else you did…'), { target: { value: 'walked the dog' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Something else you did…'), { key: 'Enter' });
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('walked the dog'));
  });

  // Found by this sweep as a BUG (the free line swallowed ok:false and closed as if it saved) and
  // fixed at integration the same day — the free line now checks `ok` exactly like screen 2's paths.
  it('a failed free-line log (ok: false) keeps the sheet open and shows a note, not a silent close', async () => {
    logAdhoc.mockResolvedValueOnce({ ok: false });
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount({}, { onLogged, onClose });
    fireEvent.change(screen.getByPlaceholderText('Something else you did…'), { target: { value: 'off-plan thing' } });
    fireEvent.click(screen.getByText('Log'));
    await waitFor(() => expect(logAdhoc).toHaveBeenCalledWith('off-plan thing'));
    expect(onClose).not.toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
    expect(screen.getByText(/didn't save/i)).toBeTruthy();
  });
});

describe('QuickAddSheet — the weight row', () => {
  function openWeightRow() {
    fireEvent.click(screen.getByLabelText('Log a weight'));
  }

  it('submits at the resolved default unit (kg, when nothing is stored)', async () => {
    getUnits.mockResolvedValue(null);
    mount({ plan: basePlan([weighActivity]) });
    openWeightRow();
    await waitFor(() => expect(screen.getByText('kg ⇄')).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Today's weight"), { target: { value: '82.5' } });
    fireEvent.click(screen.getByText('Add it to the trend'));
    await waitFor(() => expect(recordWeighInToday).toHaveBeenCalledWith(82.5, 'kg'));
  });

  it('toggling the unit changes which unit the submit carries', async () => {
    getUnits.mockResolvedValue(null);
    mount({ plan: basePlan([weighActivity]) });
    openWeightRow();
    await waitFor(() => expect(screen.getByText('kg ⇄')).toBeTruthy());
    fireEvent.click(screen.getByText('kg ⇄'));
    expect(screen.getByText('lb ⇄')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Today's weight"), { target: { value: '180' } });
    fireEvent.click(screen.getByText('Add it to the trend'));
    await waitFor(() => expect(recordWeighInToday).toHaveBeenCalledWith(180, 'lb'));
  });

  it('Enter in the weight field submits the same as the button', async () => {
    getUnits.mockResolvedValue(null);
    mount({ plan: basePlan([weighActivity]) });
    openWeightRow();
    await waitFor(() => expect(screen.getByText('kg ⇄')).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Today's weight"), { target: { value: '90' } });
    fireEvent.keyDown(screen.getByLabelText("Today's weight"), { key: 'Enter' });
    await waitFor(() => expect(recordWeighInToday).toHaveBeenCalledWith(90, 'kg'));
  });

  it('an honest failure shows a note and never claims the number was noted', async () => {
    getUnits.mockResolvedValue(null);
    recordWeighInToday.mockRejectedValueOnce(new Error('offline'));
    mount({ plan: basePlan([weighActivity]) });
    openWeightRow();
    await waitFor(() => expect(screen.getByText('kg ⇄')).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Today's weight"), { target: { value: '82.5' } });
    fireEvent.click(screen.getByText('Add it to the trend'));
    await waitFor(() => expect(recordWeighInToday).toHaveBeenCalled());
    expect(await screen.findByText("That didn't save — check the number and try again.")).toBeTruthy();
    expect(screen.queryByText(/Noted/)).toBeNull();
  });
});

describe('QuickAddSheet — the photo row', () => {
  function pickPhoto(container: HTMLElement) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'progress.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('a picked file is downscaled, then uploaded through the mutation with the downscaled photo', async () => {
    getProgressPhotosStatus.mockResolvedValue({ enabled: true, count: 0, next_due: null });
    const { container } = mount();
    await screen.findByText('Take a progress photo');
    pickPhoto(container);
    await waitFor(() => expect(downscalePhoto).toHaveBeenCalled());
    await waitFor(() => expect(uploadMutateAsync).toHaveBeenCalledWith({ photo: 'data:image/jpeg;base64,AAA' }));
    expect(await screen.findByText('Saved — dated & weight-stamped')).toBeTruthy();
  });

  it('an honest failure (the mutation hands back nothing stored) says so, never "Saved"', async () => {
    getProgressPhotosStatus.mockResolvedValue({ enabled: true, count: 0, next_due: null });
    uploadMutateAsync.mockResolvedValueOnce(null);
    const { container } = mount();
    await screen.findByText('Take a progress photo');
    pickPhoto(container);
    expect(await screen.findByText("That didn't save — give it another try")).toBeTruthy();
    expect(screen.queryByText('Saved — dated & weight-stamped')).toBeNull();
  });
});
