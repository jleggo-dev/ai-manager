import { supabase } from './supabase';
import { resolveApiUrl } from './api-url';

const DEV_API_KEY = import.meta.env.VITE_DEV_API_KEY || '';
const IS_DEV_AUTH = Boolean(DEV_API_KEY);

const S_ACCESS = 'aim_access_token';
const S_WORKSPACE = 'aim_workspace_id';

interface SessionCache {
  accessToken: string | null;
  workspaceId: string | null;
}

export interface SessionUser {
  id: string;
  email: string | null;
  display_name: string | null;
}

function readStorage(): SessionCache {
  try {
    return {
      accessToken: sessionStorage.getItem(S_ACCESS),
      workspaceId: sessionStorage.getItem(S_WORKSPACE),
    };
  } catch {
    return { accessToken: null, workspaceId: null };
  }
}

let cache = readStorage();

let sessionUser: SessionUser | null = null;

export function getSessionUser(): SessionUser | null {
  return sessionUser;
}

export function getAccessToken(): string | null {
  if (IS_DEV_AUTH) return DEV_API_KEY;
  return cache.accessToken;
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
  try {
    sessionStorage.removeItem(S_ACCESS);
    sessionStorage.removeItem(S_WORKSPACE);
  } catch {
    /* ignore */
  }
}

function persistAccessToken(token: string | null): void {
  cache.accessToken = token || null;
  try {
    if (token) sessionStorage.setItem(S_ACCESS, token);
    else sessionStorage.removeItem(S_ACCESS);
  } catch {
    /* ignore */
  }
}

async function runBootstrap(): Promise<void> {
  const token = getAccessToken();
  if (!token) return;
  const res = await fetch(resolveApiUrl('/api/auth/bootstrap'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Bootstrap failed');
  sessionUser = body.user ?? sessionUser;
  const first = body.workspaces?.[0]?.workspace_id;
  if (first && !getWorkspaceId()) setWorkspaceId(first);
}

export async function signInWithGoogle(): Promise<void> {
  if (IS_DEV_AUTH) return;
  if (!supabase) {
    throw new Error('Supabase is not configured (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)');
  }
  if (typeof window === 'undefined') {
    throw new Error('Google sign-in is only available in the browser');
  }
  const redirectTo = `${window.location.origin}${window.location.pathname || '/'}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) throw error;
  const url = data?.url;
  if (!url) throw new Error('No OAuth URL returned — enable Google in Supabase Auth providers');
  window.location.assign(url);
}

export async function signOut(): Promise<void> {
  if (IS_DEV_AUTH) return;
  try {
    if (supabase) await supabase.auth.signOut();
  } finally {
    clearAuthSession();
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

export async function initAuthSession(): Promise<void> {
  if (IS_DEV_AUTH) {
    sessionUser = { id: '00000000-0000-0000-0000-000000000000', email: 'dev@localhost', display_name: 'Dev (API key)' };
    return;
  }

  if (!supabase) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    persistAccessToken(session.access_token);
    try {
      await runBootstrap();
    } catch {
      /* bootstrap may fail if API down — user can sign in again */
    }
    mergeSessionUserFromSupabase(session.user);
  }

  supabase.auth.onAuthStateChange((event, refreshedSession) => {
    if (event === 'TOKEN_REFRESHED' && refreshedSession) {
      persistAccessToken(refreshedSession.access_token);
      mergeSessionUserFromSupabase(refreshedSession.user);
    }
    if (event === 'SIGNED_OUT') {
      clearAuthSession();
    }
  });
}
