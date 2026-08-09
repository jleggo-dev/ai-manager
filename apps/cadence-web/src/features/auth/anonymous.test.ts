import { isAnonymousSession, startAnonymousSession } from './anonymous.ts';

const signInAnonymously = vi.fn();
vi.mock('../../lib/supabase.ts', () => ({
  supabase: { auth: { signInAnonymously: (...a: unknown[]) => signInAnonymously(...a) } },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_CADENCE_SUPABASE_URL', 'https://health-tracker.supabase.co');
});
afterEach(() => vi.unstubAllEnvs());

describe('startAnonymousSession', () => {
  it('reports ok when a session comes back', async () => {
    signInAnonymously.mockResolvedValue({ data: { session: { user: {} } }, error: null });
    await expect(startAnonymousSession()).resolves.toBe('ok');
  });

  /**
   * The fallback is invisible to the user by design, which is exactly why it must not be invisible
   * to us: a disabled toggle on the wrong project once looked identical to the feature working.
   * The log has to name both the reason and the project the build is pointing at.
   */
  it('names the reason AND the project when the provider is disabled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    signInAnonymously.mockResolvedValue({
      data: { session: null },
      error: { message: 'Anonymous sign-ins are disabled' },
    });

    await expect(startAnonymousSession()).resolves.toBe('unavailable');
    const logged = warn.mock.calls[0]?.join(' ') ?? '';
    expect(logged).toContain('Anonymous sign-ins are disabled');
    expect(logged).toContain('health-tracker.supabase.co');
    warn.mockRestore();
  });

  it('falls back rather than throwing when the call itself blows up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    signInAnonymously.mockRejectedValue(new Error('offline'));
    await expect(startAnonymousSession()).resolves.toBe('unavailable');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('says so when the build has no project configured at all', async () => {
    vi.stubEnv('VITE_CADENCE_SUPABASE_URL', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    signInAnonymously.mockResolvedValue({ data: { session: null }, error: null });
    await startAnonymousSession();
    expect(warn.mock.calls[0]?.join(' ')).toContain('no VITE_CADENCE_SUPABASE_URL set');
    warn.mockRestore();
  });
});

describe('isAnonymousSession', () => {
  it('is true only for a session flagged anonymous', () => {
    expect(isAnonymousSession({ user: { is_anonymous: true } })).toBe(true);
    expect(isAnonymousSession({ user: { is_anonymous: false } })).toBe(false);
    expect(isAnonymousSession({ user: {} })).toBe(false);
    expect(isAnonymousSession(null)).toBe(false);
  });
});
