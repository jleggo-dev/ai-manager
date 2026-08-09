import { supabase } from '../../lib/supabase.ts';

/**
 * Let someone meet their coach before they hand over an email.
 *
 * The v2 flow builds the first week *before* the sign-up gate, so "save it" points at something
 * concrete instead of asking for a password on the strength of a promise. That needs an identity
 * from the first turn — the conversation, the captures and the draft plan all hang off a user id —
 * so onboarding opens a Supabase anonymous session and the gate later upgrades that same id in
 * place. Same id means nothing is copied, migrated, or lost at the moment of signing up.
 *
 * Anonymous sign-ins are a project-level toggle (Supabase dashboard → Authentication → Sign In /
 * Providers). With it off, `signInAnonymously` fails and this returns `unavailable` — the caller
 * then gates up front, which is exactly the flow that shipped before. Degrading to the old
 * behaviour is the whole reason this returns a status instead of throwing.
 */
export type AnonymousStart = 'ok' | 'unavailable';

export async function startAnonymousSession(): Promise<AnonymousStart> {
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    return !error && data.session ? 'ok' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** True while the current session belongs to someone who hasn't signed up yet. */
export function isAnonymousSession(session: { user?: { is_anonymous?: boolean } } | null): boolean {
  return session?.user?.is_anonymous === true;
}
