import type { Session } from '@supabase/supabase-js';
import {
  decorateDeviceAccount,
  forgetDeviceAccount,
  listDeviceAccounts,
  rememberDeviceAccount,
  resumeDeviceAccount,
} from './deviceAccounts.ts';

const setSession = vi.fn();
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { auth: { setSession: (...args: unknown[]) => setSession(...args) } },
}));

const session = (id: string, extra: Record<string, unknown> = {}): Session =>
  ({
    access_token: `at-${id}`,
    refresh_token: `rt-${id}`,
    user: { id, email: `${id}@example.com`, ...extra },
  }) as unknown as Session;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('the device roster', () => {
  it('remembers a signed-in account and keeps the newest first', () => {
    rememberDeviceAccount(session('alice'));
    rememberDeviceAccount(session('bob'));
    expect(listDeviceAccounts().map((a) => a.userId)).toEqual(['bob', 'alice']);
  });

  it('refreshes a rotated token in place rather than adding a second row', () => {
    rememberDeviceAccount(session('alice'));
    const rotated = { ...session('alice'), refresh_token: 'rt-rotated' } as Session;
    rememberDeviceAccount(rotated);
    const list = listDeviceAccounts();
    expect(list).toHaveLength(1);
    expect(list[0]?.refreshToken).toBe('rt-rotated');
  });

  it('never rosters an anonymous session — nobody can recognise it on a welcome-back screen', () => {
    rememberDeviceAccount(session('anon', { is_anonymous: true, email: null }));
    expect(listDeviceAccounts()).toEqual([]);
  });

  it('keeps the display bits across a re-remember', () => {
    rememberDeviceAccount(session('alice'));
    decorateDeviceAccount('alice', { name: 'Alice', faceId: 'mindful-guide-feminine-2' });
    rememberDeviceAccount(session('alice'));
    expect(listDeviceAccounts()[0]).toMatchObject({ name: 'Alice', faceId: 'mindful-guide-feminine-2' });
  });

  it('forgets one account without touching the others', () => {
    rememberDeviceAccount(session('alice'));
    rememberDeviceAccount(session('bob'));
    forgetDeviceAccount('alice');
    expect(listDeviceAccounts().map((a) => a.userId)).toEqual(['bob']);
  });

  it('survives a corrupted store rather than taking the sign-in screen down with it', () => {
    localStorage.setItem('cadence.device-accounts.v1', '{not json');
    expect(listDeviceAccounts()).toEqual([]);
  });
});

describe('resuming an account', () => {
  it('restores the stored session', async () => {
    rememberDeviceAccount(session('alice'));
    setSession.mockResolvedValue({ data: { session: session('alice') }, error: null });
    await expect(resumeDeviceAccount('alice')).resolves.toBe('ok');
    expect(setSession).toHaveBeenCalledWith({ access_token: 'at-alice', refresh_token: 'rt-alice' });
  });

  /**
   * This test used to assert the opposite, and the assertion was the bug: expiry deleted the row
   * "so the picker stops offering a dead tap". The tap is not dead — it needs a password — and
   * deleting the row takes the name, face and email with it. The owner hit it on his own phone
   * (2026-08-16): *"it removed my name and account. That shouldn't happen (even if the sign-in
   * expired that shouldn't happen)."* On a screen headed "Welcome back", your own face vanishing
   * reads as the account being gone, which for an app promising never to make you start over is
   * the cruellest possible false alarm.
   */
  it('keeps the person and drops only the dead tokens when a session expires', async () => {
    rememberDeviceAccount(session('alice'));
    setSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid refresh token' } });

    await expect(resumeDeviceAccount('alice')).resolves.toBe('expired');

    const [row] = listDeviceAccounts();
    expect(row).toBeDefined();
    expect(row!.userId).toBe('alice');
    expect(row!.name).toBe(session('alice').user.user_metadata?.full_name ?? row!.name);
    expect(row!.email).toBe('alice@example.com');
    // Only the credentials are gone.
    expect(row!.refreshToken).toBeNull();
    expect(row!.accessToken).toBeNull();
  });

  /** A row with no tokens is known-but-locked: it must not silently retry a session it lacks. */
  it('reports an expired row as unavailable on a second tap, without forgetting it', async () => {
    rememberDeviceAccount(session('alice'));
    setSession.mockResolvedValue({ data: { session: null }, error: { message: 'invalid refresh token' } });
    await resumeDeviceAccount('alice');
    setSession.mockClear();

    await expect(resumeDeviceAccount('alice')).resolves.toBe('unavailable');
    expect(setSession).not.toHaveBeenCalled();
    expect(listDeviceAccounts()).toHaveLength(1);
  });

  /** Removing is still a deliberate act, and still works — this fix must not disarm the minus. */
  it('still forgets a row the user explicitly removes', async () => {
    rememberDeviceAccount(session('alice'));
    forgetDeviceAccount('alice');
    expect(listDeviceAccounts()).toEqual([]);
  });

  it('reports an unknown account rather than throwing', async () => {
    await expect(resumeDeviceAccount('nobody')).resolves.toBe('unavailable');
    expect(setSession).not.toHaveBeenCalled();
  });
});
