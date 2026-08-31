import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { isCoachFaceId } from '@cadence/shared';
import { CoachFaceProvider } from './CoachFaceProvider.tsx';
import { useEnsureCoachFace } from './useEnsureCoachFace.ts';

const getCoachFace = vi.fn();
const setCoachFace = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getCoachFace: (...a: unknown[]) => getCoachFace(...a),
  setCoachFace: (...a: unknown[]) => setCoachFace(...a),
}));

const wrapper = ({ children }: { children: ReactNode }) => <CoachFaceProvider>{children}</CoachFaceProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  setCoachFace.mockResolvedValue(null);
});

describe('useEnsureCoachFace', () => {
  it('draws and persists a face when onboarding finds none', async () => {
    getCoachFace.mockResolvedValue({ ok: true, faceId: null });
    renderHook(() => useEnsureCoachFace(true), { wrapper });

    await waitFor(() => expect(setCoachFace).toHaveBeenCalledTimes(1));
    expect(isCoachFaceId(setCoachFace.mock.calls[0]![0])).toBe(true);
  });

  it('leaves an already-chosen portrait alone', async () => {
    getCoachFace.mockResolvedValue({ ok: true, faceId: 'mindful-guide-feminine-2' });
    renderHook(() => useEnsureCoachFace(true), { wrapper });

    await waitFor(() => expect(getCoachFace).toHaveBeenCalled());
    expect(setCoachFace).not.toHaveBeenCalled();
  });

  /**
   * The guard that matters: someone who deliberately chose the mark must not be quietly dealt a
   * portrait on their next visit. Only the first conversation draws.
   */
  it('never draws when disabled, even with no face set', async () => {
    getCoachFace.mockResolvedValue({ ok: true, faceId: null });
    renderHook(() => useEnsureCoachFace(false), { wrapper });

    await waitFor(() => expect(getCoachFace).toHaveBeenCalled());
    expect(setCoachFace).not.toHaveBeenCalled();
  });

  /**
   * `face` is null both for "hasn't picked" and "still loading". Drawing on the second would
   * overwrite a portrait chosen weeks ago — so nothing may happen before the load settles.
   */
  it('waits for the load to settle before deciding there is no face', async () => {
    let resolve: ((v: { ok: boolean; faceId?: string | null }) => void) | null = null;
    getCoachFace.mockReturnValue(new Promise((r) => (resolve = r)));
    renderHook(() => useEnsureCoachFace(true), { wrapper });

    await Promise.resolve();
    expect(setCoachFace).not.toHaveBeenCalled();

    resolve!({ ok: true, faceId: 'rhythm-keeper-neutral' });
    await waitFor(() => expect(getCoachFace).toHaveBeenCalled());
    expect(setCoachFace).not.toHaveBeenCalled();
  });

  /**
   * A FAILED read is "unknown", not "hasn't picked" — the stored pick may be fine behind a 401
   * fired before auth resolved (#311's paint-before-auth boot) or a blip. Drawing here is how a
   * user's real portrait got overwritten with a random one, permanently, server-side.
   */
  it('never draws over a failed read', async () => {
    getCoachFace.mockResolvedValue({ ok: false });
    renderHook(() => useEnsureCoachFace(true), { wrapper });

    await waitFor(() => expect(getCoachFace).toHaveBeenCalled());
    await Promise.resolve();
    expect(setCoachFace).not.toHaveBeenCalled();
  });

  /** The paint-before-auth mount must not fire a doomed, tokenless read at all. */
  it('does not read until authReady', async () => {
    getCoachFace.mockResolvedValue({ ok: true, faceId: null });
    const gated = ({ children }: { children: ReactNode }) => (
      <CoachFaceProvider authReady={false}>{children}</CoachFaceProvider>
    );
    renderHook(() => useEnsureCoachFace(false), { wrapper: gated });

    await Promise.resolve();
    expect(getCoachFace).not.toHaveBeenCalled();
  });
});
