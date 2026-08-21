/**
 * The narration is the feature, so these test the SEQUENCE a person actually sees — not that the
 * copy strings exist. Twice now this codebase has shipped a status line that was correct in the
 * unit and never reached the screen (PLAN.md, 2026-08-17 and 2026-08-21); asserting phrasing in
 * isolation is exactly the test that missed both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const api = { readMealPhoto: vi.fn(), logMealFromReading: vi.fn() };
vi.mock('../../lib/api.ts', () => ({
  readMealPhoto: (...a: unknown[]) => api.readMealPhoto(...a),
  logMealFromReading: (...a: unknown[]) => api.logMealFromReading(...a),
}));

const { useMealPhotoRead } = await import('./useMealPhotoRead.ts');

const READING = 'Assume a 250ml latte: roughly 200ml milk and 50ml espresso.';
const ROW = { log_id: 'm1', meal: 'breakfast', macros: { kcal: 150 } };

beforeEach(() => {
  vi.clearAllMocks();
  api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: READING, error: null });
  api.logMealFromReading.mockResolvedValue(ROW);
});
afterEach(() => vi.useRealTimers());

describe('useMealPhotoRead', () => {
  it('walks idle → reading → confirming → nutrition → done', async () => {
    const { result } = renderHook(() => useMealPhotoRead());
    expect(result.current.phase).toBe('idle');

    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx', 'a latte');
    });
    // The reading is on screen BEFORE the numbers are computed — the whole point of the split.
    expect(result.current.phase).toBe('confirming');
    expect(result.current.reading).toBe(READING);

    await act(async () => {
      await result.current.commit({ caption: 'a latte', meal: 'breakfast' });
    });
    expect(result.current.phase).toBe('done');
    expect(result.current.meal).toEqual(ROW);
  });

  it('shows a progress line the moment a stage starts, never a blank', async () => {
    // `shouldAdvanceTime` keeps the microtask queue alive under fake timers; without it any await
    // inside act() deadlocks, which is what the first version of this test did.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolve!: (v: unknown) => void;
    api.readMealPhoto.mockReturnValue(new Promise((r) => (resolve = r)));

    const { result } = renderHook(() => useMealPhotoRead());
    act(() => void result.current.read('data:image/jpeg;base64,xxx'));

    // The stage's first line must be up before any timer fires — a blank frame reads as a hang.
    expect(result.current.phase).toBe('reading');
    expect(result.current.progress).toBe('Sending your photo…');

    // ...and it moves on as the wait runs, which is the thing that makes 40s tolerable.
    act(() => void vi.advanceTimersByTime(8000));
    expect(result.current.progress).toBe('Picking out the separate parts…');

    await act(async () => {
      resolve({ photo_ref: 'ref/1.jpg', reading: READING, error: null });
    });
    expect(result.current.phase).toBe('confirming');
  });

  /**
   * A correction outranks anything the model saw, so what the user edited is what gets sent — not
   * the original. This is the reason the split exists at all.
   */
  it('sends the EDITED reading, not the model’s', async () => {
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    await act(async () => {
      await result.current.commit({ reading: 'Actually oat milk, and the large size.' });
    });
    expect(api.logMealFromReading).toHaveBeenCalledWith(
      expect.objectContaining({ reading: 'Actually oat milk, and the large size.' }),
    );
  });

  it('surfaces a failed read as an error rather than a silent stall', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBeTruthy();
  });

  it('reset clears everything so a second photo starts clean', async () => {
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
    expect(result.current.reading).toBe('');
    expect(result.current.progress).toBe('');
  });
});
