/**
 * The narration is the feature, so these test the SEQUENCE a person actually sees — not that the
 * copy strings exist. Twice now this codebase has shipped a status line that was correct in the
 * unit and never reached the screen (PLAN.md, 2026-08-17 and 2026-08-21); asserting phrasing in
 * isolation is exactly the test that missed both.
 *
 * Since 2026-11-01 (FOOD-LOGGING-COACH-LED.md, build step 4) the hook ends at `priced` in every
 * mode: the confirmed reading comes back as the coach's rows for the card, with the photo and the
 * reading riding on the preview, and the card's confirm does the write. Since the review of #457
 * every fault is told in plain words by stage, both calls are bounded, and leaving aborts them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const api = { readMealPhoto: vi.fn(), previewMealFromReading: vi.fn() };
vi.mock('../../lib/api.ts', () => ({
  readMealPhoto: (...a: unknown[]) => api.readMealPhoto(...a),
  previewMealFromReading: (...a: unknown[]) => api.previewMealFromReading(...a),
}));

const { useMealPhotoRead, faultCopy, READ_BOUND_MS, NUTRITION_BOUND_MS } = await import('./useMealPhotoRead.ts');
const { READ_FAILED, NO_FOODS, TOO_LONG, WORK_OUT_FAILED } = await import('./photoReadCopy.ts');

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

/** A call that never answers on its own and rejects with the signal's reason when aborted. */
const hangs = () => (_a: unknown, opts?: { signal?: AbortSignal }) =>
  new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(opts.signal!.reason)));
const hangsRead = () => (_p: unknown, _c: unknown, opts?: { signal?: AbortSignal }) =>
  new Promise((_, reject) => opts?.signal?.addEventListener('abort', () => reject(opts.signal!.reason)));

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
    expect(result.current.readFailed).toBe(false);
    expect(api.previewMealFromReading).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.commit({ caption: 'a latte', meal: 'breakfast' });
    });
    expect(result.current.phase).toBe('priced');
    expect(api.previewMealFromReading).toHaveBeenCalledWith(
      { reading: READING, caption: 'a latte', meal: 'breakfast' },
      expect.objectContaining({ signal: expect.anything() }),
    );
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
      expect.anything(),
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

  it('the eyes answering that they could not read it (a 200 with error) opens the box empty, flagged', async () => {
    api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: '', error: 'Error: no food' });
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    expect(result.current.phase).toBe('confirming');
    expect(result.current.readFailed).toBe(true);
    expect(result.current.photoRef).toBe('ref/1.jpg');
    // Near-miss: an error alongside a reading is a reading — the words won.
    api.readMealPhoto.mockResolvedValue({ photo_ref: 'ref/1.jpg', reading: READING, error: 'Error: slow' });
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    expect(result.current.readFailed).toBe(false);
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

describe('useMealPhotoRead — faults, by stage, in plain words', () => {
  it.each([
    ['read', new Error('photo read failed: 500'), READ_FAILED],
    ['read', new DOMException('took too long', 'TimeoutError'), TOO_LONG],
    ['nutrition', Object.assign(new Error('meal preview failed: 400'), { status: 400 }), NO_FOODS],
    ['nutrition', Object.assign(new Error('meal preview failed: 500'), { status: 500 }), WORK_OUT_FAILED],
    ['nutrition', new TypeError('Failed to fetch'), WORK_OUT_FAILED],
    ['nutrition', new DOMException('took too long', 'TimeoutError'), TOO_LONG],
    ['nutrition', new DOMException('left', 'AbortError'), TOO_LONG],
  ] as const)('%s + %o → %s', (stage, fault, copy) => {
    expect(faultCopy(stage, fault)).toBe(copy);
    // Never the fault's own words.
    expect(copy).not.toMatch(/failed|fetch|\d{3}/);
  });

  it('a failed read is an error from the read stage, so the door offers a retry', async () => {
    api.readMealPhoto.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.failedAt).toBe('read');
    expect(result.current.error).toBe(READ_FAILED);
  });

  it('a read with no foods in it is an error from the nutrition stage, with a way back to the reading', async () => {
    api.previewMealFromReading.mockResolvedValue({ ...PRICED, items: [] });
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    await act(async () => {
      await result.current.commit();
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.failedAt).toBe('nutrition');
    expect(result.current.error).toBe(NO_FOODS);
    act(() => result.current.unprice());
    expect(result.current.phase).toBe('confirming');
    expect(result.current.reading).toBe(READING);
    expect(result.current.error).toBeNull();
  });

  it('a read past its bound lands in the error phase with the too-long words', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.readMealPhoto.mockImplementation(hangsRead());
    const { result } = renderHook(() => useMealPhotoRead());
    act(() => void result.current.read('data:image/jpeg;base64,xxx'));
    expect(result.current.phase).toBe('reading');
    await act(async () => {
      vi.advanceTimersByTime(READ_BOUND_MS + 1);
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.failedAt).toBe('read');
    expect(result.current.error).toBe(TOO_LONG);
  });

  it('working it out past its bound lands in the error phase too, keeping the reading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useMealPhotoRead());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,xxx');
    });
    api.previewMealFromReading.mockImplementation(hangs());
    act(() => void result.current.commit());
    expect(result.current.phase).toBe('nutrition');
    await act(async () => {
      vi.advanceTimersByTime(NUTRITION_BOUND_MS + 1);
    });
    expect(result.current.phase).toBe('error');
    expect(result.current.failedAt).toBe('nutrition');
    expect(result.current.error).toBe(TOO_LONG);
    expect(result.current.reading).toBe(READING);
  });

  it('a second read supersedes the first: the first’s abort changes nothing, and its timer cannot fire later', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen: AbortSignal[] = [];
    api.readMealPhoto
      .mockImplementationOnce((_p: unknown, _c: unknown, opts: { signal: AbortSignal }) => {
        seen.push(opts.signal);
        return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason)));
      })
      .mockResolvedValueOnce({ photo_ref: 'ref/2.jpg', reading: READING, error: null });
    const { result } = renderHook(() => useMealPhotoRead());
    act(() => void result.current.read('data:image/jpeg;base64,one'));
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,two');
    });
    // The second call is what the screen shows; the first was aborted and said nothing.
    expect(seen[0]?.aborted).toBe(true);
    expect(result.current.phase).toBe('confirming');
    expect(result.current.error).toBeNull();
    expect(result.current.photoRef).toBe('ref/2.jpg');
    // The first call's bound passing cannot turn the settled read into "too long".
    await act(async () => {
      vi.advanceTimersByTime(READ_BOUND_MS + 1);
    });
    expect(result.current.phase).toBe('confirming');
    expect(result.current.error).toBeNull();
  });

  it('cancel, then a fresh read, works as if nothing had been in flight', async () => {
    api.readMealPhoto.mockImplementationOnce(hangsRead());
    const { result } = renderHook(() => useMealPhotoRead());
    act(() => void result.current.read('data:image/jpeg;base64,one'));
    act(() => result.current.cancel());
    await act(async () => {
      await result.current.read('data:image/jpeg;base64,two');
    });
    expect(result.current.phase).toBe('confirming');
    expect(result.current.error).toBeNull();
  });

  it('leaving aborts the call in flight and shows nothing for it', async () => {
    api.readMealPhoto.mockImplementation(hangsRead());
    const { result } = renderHook(() => useMealPhotoRead());
    act(() => void result.current.read('data:image/jpeg;base64,xxx'));
    expect(result.current.phase).toBe('reading');
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.phase).not.toBe('error');
  });
});
