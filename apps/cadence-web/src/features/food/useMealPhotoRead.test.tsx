/**
 * The narration is the feature, so these test the SEQUENCE a person actually sees — not that the
 * copy strings exist. Twice now this codebase has shipped a status line that was correct in the
 * unit and never reached the screen (PLAN.md, 2026-08-17 and 2026-08-21); asserting phrasing in
 * isolation is exactly the test that missed both.
 *
 * Since 2026-11-01 (FOOD-LOGGING-COACH-LED.md, build step 4) the hook ends at `priced` in every
 * mode: the confirmed reading comes back as the coach's rows for the card, with the photo and the
 * reading riding on the preview, and the card's confirm does the write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const api = { readMealPhoto: vi.fn(), previewMealFromReading: vi.fn() };
vi.mock('../../lib/api.ts', () => ({
  readMealPhoto: (...a: unknown[]) => api.readMealPhoto(...a),
  previewMealFromReading: (...a: unknown[]) => api.previewMealFromReading(...a),
}));

const { useMealPhotoRead } = await import('./useMealPhotoRead.ts');

const READING = 'A latte and a banana.\n\n1 venti latte\n1 medium banana';
const PRICED = {
  meal: 'breakfast',
  raw_text: '1 venti latte\n1 medium banana',
  items: [{ name: 'Caffè Latte (Venti)', qty: 1, unit: 'venti', est: { kcal: 250 }, food_id: 'f-latte' }],
  macros: { kcal: 250 },
  confidence: null,
  flags: {},
  coach: { reached: true, calls: 1, checked: ['venti latte: your foods: 1 rows'] },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: READING, error: null });
  api.previewMealFromReading.mockResolvedValue(PRICED);
});
afterEach(() => vi.useRealTimers());

describe('useMealPhotoRead', () => {
  it('walks idle → reading → confirming → nutrition → priced, and writes nothing itself', async () => {
    const { result } = renderHook(() => useMealPhotoRead());
    expect(result.current.phase).toBe('idle');

    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx', 'a latte');
    });
    // The reading is on screen BEFORE anything is looked up — the whole point of the split.
    expect(result.current.phase).toBe('confirming');
    expect(result.current.reading).toBe(READING);
    expect(api.previewMealFromReading).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.commit({ caption: 'a latte', meal: 'breakfast' });
    });
    expect(result.current.phase).toBe('priced');
    expect(api.previewMealFromReading).toHaveBeenCalledWith({
      reading: READING,
      caption: 'a latte',
      meal: 'breakfast',
    });
    // The photo and the reading ride on the preview, so the card's confirm keeps them on the row.
    expect(result.current.preview).toEqual({ ...PRICED, photo_ref: 'ref/1.jpg', photo_reading: READING });
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

  it('narrates the second stage as the coach-led read it is', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let resolve!: (v: unknown) => void;
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    api.previewMealFromReading.mockReturnValue(new Promise((r) => (resolve = r)));
    act(() => void result.current.commit());
    expect(result.current.phase).toBe('nutrition');
    expect(result.current.progress).toBe('Looking each line up in your foods and the food databases…');
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.progress).toBe('The coach is reading what the lookups found…');
    await act(async () => {
      resolve(PRICED);
    });
    expect(result.current.phase).toBe('priced');
  });

  /**
   * A correction outranks anything the model saw, so what the user edited is what gets read — not
   * the original. This is the reason the split exists at all.
   */
  it('reads the EDITED reading, not the model’s, and keeps it as the row’s reading', async () => {
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    await act(async () => {
      await result.current.commit({ reading: '1 venti oat milk latte' });
    });
    expect(api.previewMealFromReading).toHaveBeenCalledWith(
      expect.objectContaining({ reading: '1 venti oat milk latte' }),
    );
    expect(result.current.preview?.photo_reading).toBe('1 venti oat milk latte');
  });

  it('an empty reading (the read failed, they went on from the caption) rides no reading on the preview', async () => {
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.commit({ reading: '', caption: 'a banana' });
    });
    expect(result.current.phase).toBe('priced');
    expect(result.current.preview?.photo_reading).toBeUndefined();
    // No photo_ref either: the read never ran, so there is nothing stored to point at.
    expect(result.current.preview?.photo_ref).toBeUndefined();
  });

  it('a read with no foods in it is an error with a way forward, not an empty card', async () => {
    api.previewMealFromReading.mockResolvedValue({ ...PRICED, items: [] });
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toMatch(/couldn’t pick any foods/);
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

  it('unprice goes back to the reading with the numbers dropped; reset clears everything', async () => {
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
      await result.current.commit();
    });
    act(() => result.current.unprice());
    expect(result.current.phase).toBe('confirming');
    expect(result.current.preview).toBeNull();
    expect(result.current.reading).toBe(READING);
    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
    expect(result.current.reading).toBe('');
    expect(result.current.photoRef).toBe('');
    expect(result.current.progress).toBe('');
  });
});
