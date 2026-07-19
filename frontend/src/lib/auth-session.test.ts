const subscriptionUnsubscribe = vi.fn();
const onAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: subscriptionUnsubscribe } },
}));
const getSession = vi.fn(async () => ({ data: { session: null } }));

/** Mutable so individual tests can enable a fake Supabase client. */
let supabaseClient: {
  auth: {
    getSession: typeof getSession;
    onAuthStateChange: typeof onAuthStateChange;
  };
} | null = null;

vi.mock('./supabase', () => ({
  get supabase() {
    return supabaseClient;
  },
  isSupabaseConfigured: () => Boolean(supabaseClient),
  clearAuthHashFromUrl: vi.fn(),
}));
vi.mock('./api-url', () => ({ resolveApiUrl: (p: string) => p }));

const STORAGE_KEY_ACCESS = 'aim_access_token';
const STORAGE_KEY_WORKSPACE = 'aim_workspace_id';

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  supabaseClient = null;
  subscriptionUnsubscribe.mockClear();
  onAuthStateChange.mockClear();
  getSession.mockClear();
  getSession.mockResolvedValue({ data: { session: null } });
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store[k] = v;
    }),
    removeItem: vi.fn((k: string) => {
      delete store[k];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  });
  vi.stubEnv('VITE_DEV_API_KEY', '');
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function loadModule() {
  return import('./auth-session');
}

describe('auth-session', () => {
  it('getAccessToken returns null when no session exists', async () => {
    const { getAccessToken } = await loadModule();
    expect(getAccessToken()).toBeNull();
  });

  it('setWorkspaceId stores workspace ID in sessionStorage', async () => {
    const { setWorkspaceId } = await loadModule();
    setWorkspaceId('ws-123');
    expect(sessionStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY_WORKSPACE, 'ws-123');
    expect(store[STORAGE_KEY_WORKSPACE]).toBe('ws-123');
  });

  it('getWorkspaceId retrieves stored workspace ID', async () => {
    const { setWorkspaceId, getWorkspaceId } = await loadModule();
    setWorkspaceId('ws-456');
    expect(getWorkspaceId()).toBe('ws-456');
  });

  it('clearAuthSession clears tokens and workspace from storage', async () => {
    store[STORAGE_KEY_ACCESS] = 'tok';
    store[STORAGE_KEY_WORKSPACE] = 'ws-1';
    const { clearAuthSession, getAccessToken, getWorkspaceId } = await loadModule();

    clearAuthSession();

    expect(getAccessToken()).toBeNull();
    expect(getWorkspaceId()).toBeNull();
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY_ACCESS);
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY_WORKSPACE);
  });

  it('getSessionUser returns null when no user is cached', async () => {
    const { getSessionUser } = await loadModule();
    expect(getSessionUser()).toBeNull();
  });

  it('getAccessToken returns the dev key when VITE_DEV_API_KEY is set', async () => {
    vi.stubEnv('VITE_DEV_API_KEY', 'dev-key-abc');
    const { getAccessToken } = await loadModule();
    expect(getAccessToken()).toBe('dev-key-abc');
  });

  it('getAccessToken returns null after signOut even when dev key is configured', async () => {
    vi.stubEnv('VITE_DEV_API_KEY', 'dev-key-abc');
    const { signOut, getAccessToken } = await loadModule();
    await signOut();
    expect(getAccessToken()).toBeNull();
  });

  it('getAccessToken ignores stale API keys stored as session tokens', async () => {
    store[STORAGE_KEY_ACCESS] = 'aim_sk_old_deleted_key';
    const { getAccessToken } = await loadModule();
    expect(getAccessToken()).toBeNull();
    expect(store[STORAGE_KEY_ACCESS]).toBeUndefined();
  });

  it('setWorkspaceId with null clears the workspace', async () => {
    const { setWorkspaceId, getWorkspaceId } = await loadModule();
    setWorkspaceId('ws-999');
    expect(getWorkspaceId()).toBe('ws-999');

    setWorkspaceId(null);
    expect(getWorkspaceId()).toBeNull();
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY_WORKSPACE);
  });

  it('multiple calls to get/set are consistent', async () => {
    const { setWorkspaceId, getWorkspaceId, getAccessToken } = await loadModule();

    setWorkspaceId('ws-a');
    expect(getWorkspaceId()).toBe('ws-a');

    setWorkspaceId('ws-b');
    expect(getWorkspaceId()).toBe('ws-b');

    setWorkspaceId(null);
    expect(getWorkspaceId()).toBeNull();

    expect(getAccessToken()).toBeNull();
  });

  it('initAuthSession returns an unsubscribe that removes the onAuthStateChange listener', async () => {
    supabaseClient = {
      auth: {
        getSession,
        onAuthStateChange,
      },
    };

    const { initAuthSession } = await loadModule();
    const unsubscribe = await initAuthSession();

    expect(onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(subscriptionUnsubscribe).not.toHaveBeenCalled();

    unsubscribe();
    expect(subscriptionUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('initAuthSession returns a no-op unsubscribe when Supabase is not configured', async () => {
    const { initAuthSession } = await loadModule();
    const unsubscribe = await initAuthSession();
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(onAuthStateChange).not.toHaveBeenCalled();
  });
});
