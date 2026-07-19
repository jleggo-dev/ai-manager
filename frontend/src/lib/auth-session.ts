import type { Provider } from '@supabase/supabase-js';
import { supabase, clearAuthHashFromUrl, isSupabaseConfigured } from './supabase';
import { resolveApiUrl } from './api-url';

const DEV_API_KEY = import.meta.env.VITE_DEV_API_KEY || '';
const IS_DEV_AUTH = Boolean(DEV_API_KEY);
const API_KEY_PREFIX = 'aim_sk_';

/** Local dev skip-OAuth mode — only when Supabase auth is not configured. */
function isDevAuthBypassActive(): boolean {
  return IS_DEV_AUTH && !isSupabaseConfigured() && !isSignedOut();
}

function isApiKeyToken(token: string | null | undefined): boolean {
  return Boolean(token?.startsWith(API_KEY_PREFIX));
}

/** Supabase JWTs only — never treat workspace API keys as session tokens. */
function sanitizeSessionToken(token: string | null): string | null {
  if (!token || isApiKeyToken(token)) return null;
  return token;
}

const S_ACCESS = 'aim_access_token';
const S_WORKSPACE = 'aim_workspace_id';
const S_SIGNED_OUT = 'aim_signed_out';

export type AccountStatus = 'pending' | 'approved' | 'suspended';

interface SessionCache {
  accessToken: string | null;
  workspaceId: string | null;
}

export interface SessionUser {
  id: string;
  email: string | null;
  display_name: string | null;
}

export interface BootstrapResult {
  user: SessionUser;
  status: AccountStatus;
  approved: boolean;
  workspaces?: { workspace_id: string; role: string }[];
}

function readStorage(): SessionCache {
  try {
    const rawToken = sessionStorage.getItem(S_ACCESS);
    const accessToken = sanitizeSessionToken(rawToken);
    if (rawToken && !accessToken) {
      sessionStorage.removeItem(S_ACCESS);
    }
    return {
      accessToken,
      workspaceId: sessionStorage.getItem(S_WORKSPACE),
    };
  } catch {
    return { accessToken: null, workspaceId: null };
  }
}

let cache = readStorage();
let sessionUser: SessionUser | null = null;
let accountStatus: AccountStatus = 'pending';

function isSignedOut(): boolean {
  try {
    return sessionStorage.getItem(S_SIGNED_OUT) === '1';
  } catch {
    return false;
  }
}

function markSignedOut(): void {
  try {
    sessionStorage.setItem(S_SIGNED_OUT, '1');
  } catch {
    /* sessionStorage unavailable */
  }
}

function clearSignedOut(): void {
  try {
    sessionStorage.removeItem(S_SIGNED_OUT);
  } catch {
    /* sessionStorage unavailable */
  }
}

type AccountStatusListener = (status: AccountStatus) => void;
const statusListeners = new Set<AccountStatusListener>();

export function getSessionUser(): SessionUser | null {
  return sessionUser;
}

export function getAccountStatus(): AccountStatus {
  return accountStatus;
}

export function setAccountStatus(status: AccountStatus): void {
  accountStatus = status;
  for (const fn of statusListeners) fn(status);
}

export function onAccountStatusChange(listener: AccountStatusListener): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getAccessToken(): string | null {
  if (isSignedOut()) return null;
  const sessionToken = sanitizeSessionToken(cache.accessToken);
  if (sessionToken) return sessionToken;
  if (isDevAuthBypassActive()) return DEV_API_KEY;
  return null;
}

export function getWorkspaceId(): string | null {
  return cache.workspaceId;
}

export function setWorkspaceId(id: string | null): void {
  cache.workspaceId = id || null;
  try {
    if (id) sessionStorage.setItem(S_WORKSPACE, id);
    else sessionStorage.removeItem(S_WORKSPACE);
  } catch {
    /* sessionStorage unavailable */
  }
}

export function clearAuthSession(): void {
  cache = { accessToken: null, workspaceId: null };
  sessionUser = null;
  accountStatus = 'pending';
  try {
    sessionStorage.removeItem(S_ACCESS);
    sessionStorage.removeItem(S_WORKSPACE);
  } catch {
    /* ignore */
  }
}

function persistAccessToken(token: string | null): void {
  const sessionToken = sanitizeSessionToken(token);
  if (sessionToken) clearSignedOut();
  cache.accessToken = sessionToken;
  try {
    if (sessionToken) sessionStorage.setItem(S_ACCESS, sessionToken);
    else sessionStorage.removeItem(S_ACCESS);
  } catch {
    /* ignore */
  }
}

async function runBootstrap(): Promise<BootstrapResult | null> {
  const token = getAccessToken();
  if (!token) return null;
  const res = await fetch(resolveApiUrl('/api/auth/bootstrap'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Bootstrap failed');

  const result = body as BootstrapResult & { workspaces?: { workspace_id: string }[] };
  sessionUser = result.user ?? sessionUser;
  if (result.status) setAccountStatus(result.status);
  const first = result.workspaces?.[0]?.workspace_id;
  if (first && !getWorkspaceId()) setWorkspaceId(first);
  return result;
}

export async function refreshBootstrap(): Promise<BootstrapResult | null> {
  try {
    return await runBootstrap();
  } catch {
    return null;
  }
}

function authRedirectUrl(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.origin}${window.location.pathname || '/'}`;
}

export async function signInWithOAuth(provider: Provider): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)');
  }
  clearSignedOut();
  try {
    sessionStorage.removeItem(S_ACCESS);
  } catch {
    /* ignore */
  }
  cache.accessToken = null;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: authRedirectUrl() },
  });
  if (error) throw error;
  const url = data?.url;
  if (!url) throw new Error(`No OAuth URL returned — enable ${provider} in Supabase Auth providers`);
  window.location.assign(url);
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithOAuth('google');
}

export interface SignUpResult {
  needsEmailConfirmation: boolean;
  sessionCreated: boolean;
}

export async function signUpWithEmail(email: string, password: string): Promise<SignUpResult> {
  if (!supabase) throw new Error('Supabase is not configured');

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { emailRedirectTo: authRedirectUrl() },
  });
  if (error) throw error;

  const sessionCreated = Boolean(data.session?.access_token);
  if (sessionCreated && data.session) {
    persistAccessToken(data.session.access_token);
    mergeSessionUserFromSupabase(data.session.user);
    await runBootstrap();
  }

  return {
    needsEmailConfirmation: !sessionCreated && !data.user?.confirmed_at,
    sessionCreated,
  };
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  if (!data.session?.access_token) throw new Error('Sign-in succeeded but no session was returned');

  persistAccessToken(data.session.access_token);
  mergeSessionUserFromSupabase(data.user);
  await runBootstrap();
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');

  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: authRedirectUrl(),
  });
  if (error) throw error;
}

export async function updatePassword(newPassword: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured');

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
  clearAuthHashFromUrl();
}

export async function signOut(): Promise<void> {
  try {
    if (supabase) await supabase.auth.signOut();
  } finally {
    clearAuthSession();
    markSignedOut();
  }
}

interface SupabaseUserLike {
  id?: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    name?: string;
    display_name?: string;
    given_name?: string;
    family_name?: string;
  };
}

function mergeSessionUserFromSupabase(user: SupabaseUserLike | null | undefined): void {
  if (!user?.id) return;
  const m = user.user_metadata || {};
  const fromOAuth =
    m.full_name || m.name || m.display_name || [m.given_name, m.family_name].filter(Boolean).join(' ').trim() || null;
  sessionUser = {
    id: sessionUser?.id || user.id,
    email: sessionUser?.email || user.email || null,
    display_name: sessionUser?.display_name || fromOAuth || null,
  };
}

async function applySessionFromSupabase(accessToken: string, user: SupabaseUserLike | null | undefined): Promise<void> {
  persistAccessToken(accessToken);
  mergeSessionUserFromSupabase(user);
  try {
    await runBootstrap();
  } catch {
    /* bootstrap may fail if API down */
  }
}

/** No-op unsubscribe when auth is bypassed or Supabase is not configured. */
const noopUnsubscribe = (): void => {};

/**
 * Bootstrap session state and subscribe to Supabase auth changes.
 * Returns an unsubscribe function — callers (e.g. App.tsx) must invoke it on cleanup
 * so remounts / StrictMode / HMR do not stack listeners (SD5).
 */
export async function initAuthSession(): Promise<() => void> {
  if (isDevAuthBypassActive()) {
    sessionUser = {
      id: '00000000-0000-0000-0000-000000000000',
      email: 'dev@localhost',
      display_name: 'Dev (API key)',
    };
    setAccountStatus('approved');
    return noopUnsubscribe;
  }

  if (!supabase) return noopUnsubscribe;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    await applySessionFromSupabase(session.access_token, session.user);
  } else if (cache.accessToken && !sanitizeSessionToken(cache.accessToken)) {
    clearAuthSession();
  }

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange(async (event, refreshedSession) => {
    if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && refreshedSession?.access_token) {
      await applySessionFromSupabase(refreshedSession.access_token, refreshedSession.user);
      if (event === 'SIGNED_IN') clearAuthHashFromUrl();
    }
    if (event === 'TOKEN_REFRESHED' && refreshedSession) {
      persistAccessToken(refreshedSession.access_token);
      mergeSessionUserFromSupabase(refreshedSession.user);
    }
    if (event === 'SIGNED_OUT') {
      clearAuthSession();
    }
    if (event === 'PASSWORD_RECOVERY' && refreshedSession?.access_token) {
      persistAccessToken(refreshedSession.access_token);
    }
  });

  return () => subscription.unsubscribe();
}

/** Handle API 403 account gate responses from the backend. */
export function handleAccountGateApiError(err: unknown): boolean {
  const data = (err as { data?: { code?: string } })?.data;
  if (data?.code === 'ACCOUNT_PENDING') {
    setAccountStatus('pending');
    return true;
  }
  if (data?.code === 'ACCOUNT_SUSPENDED') {
    setAccountStatus('suspended');
    return true;
  }
  return false;
}
