import { renderHook, waitFor } from '@testing-library/react';
import { usePushRegistered } from './usePushRegistered.ts';

const enablePush = vi.fn();
const isAvailable = vi.fn();

vi.mock('../features/settings/notifications/enablePush.ts', () => ({
  enablePushOnThisDevice: (...a: unknown[]) => enablePush(...a),
}));
vi.mock('./capability/index.ts', () => ({
  capabilities: { push: { isAvailable: () => isAvailable() } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  isAvailable.mockReturnValue(true);
  enablePush.mockResolvedValue('on');
});

const resume = () => document.dispatchEvent(new Event('visibilitychange'));
const settle = () => new Promise((r) => setTimeout(r, 10));

/**
 * `cadence.device_tokens` was found EMPTY in production — not stale, empty. The only place that
 * ever asked was the onboarding build screen, so the ask happened once in a person's life and
 * anyone past their first week could never be reached again. Every push Cadence sent settled as
 * `failed / no_devices`, which is why the owner kept reporting notifications that never arrived.
 */
describe('usePushRegistered', () => {
  it('registers on launch, once', async () => {
    renderHook(() => usePushRegistered(true));
    await waitFor(() => expect(enablePush).toHaveBeenCalledTimes(1));
  });

  it('stops asking once the token is registered', async () => {
    renderHook(() => usePushRegistered(true));
    await waitFor(() => expect(enablePush).toHaveBeenCalledTimes(1));

    resume();
    await settle();
    expect(enablePush).toHaveBeenCalledTimes(1);
  });

  /**
   * The trap the build screen proved is real: iOS cannot show a permission dialog to a
   * backgrounded app — which is exactly where someone is when they take up "leave the app if you
   * like". A missed prompt has to get another chance, and iOS makes retrying free: the system
   * dialog appears once per install and later requests resolve silently from the stored answer.
   */
  it('tries again on resume when the ask has not succeeded yet', async () => {
    enablePush.mockResolvedValue('denied');
    renderHook(() => usePushRegistered(true));
    await waitFor(() => expect(enablePush).toHaveBeenCalledTimes(1));

    resume();
    await waitFor(() => expect(enablePush).toHaveBeenCalledTimes(2));
  });

  it('gives up permanently only where push cannot exist at all', async () => {
    enablePush.mockResolvedValue('unavailable');
    renderHook(() => usePushRegistered(true));
    await waitFor(() => expect(enablePush).toHaveBeenCalledTimes(1));

    resume();
    await settle();
    expect(enablePush).toHaveBeenCalledTimes(1);
  });

  it('keeps trying after a failed server registration — an offline launch is not an answer', async () => {
    enablePush.mockResolvedValue('failed');
    renderHook(() => usePushRegistered(true));
    await waitFor(() => expect(enablePush).toHaveBeenCalledTimes(1));

    resume();
    await waitFor(() => expect(enablePush).toHaveBeenCalledTimes(2));
  });

  it('asks nothing before there is a session to register against', async () => {
    renderHook(() => usePushRegistered(false));
    await settle();
    expect(enablePush).not.toHaveBeenCalled();
  });

  it('asks nothing on a platform with no push at all', async () => {
    isAvailable.mockReturnValue(false);
    renderHook(() => usePushRegistered(true));
    await settle();
    expect(enablePush).not.toHaveBeenCalled();
  });

  it('does not fire a second overlapping ask while one is still in flight', async () => {
    enablePush.mockImplementation(() => new Promise(() => {}));
    renderHook(() => usePushRegistered(true));
    await waitFor(() => expect(enablePush).toHaveBeenCalledTimes(1));

    resume();
    resume();
    await settle();
    expect(enablePush).toHaveBeenCalledTimes(1);
  });
});
