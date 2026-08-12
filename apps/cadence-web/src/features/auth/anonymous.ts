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

/**
 * Which Supabase project this build is actually pointing at. In the message below, not decoration:
 * the web build and the iOS build read different env files, this repo's owner has four projects,
 * and "I enabled it" plus "it still doesn't work" is a long afternoon unless the log says *where*.
 */
function projectHost(): string {
  const url = import.meta.env.VITE_CADENCE_SUPABASE_URL as string | undefined;
  try {
    return url ? new URL(url).host : 'no VITE_CADENCE_SUPABASE_URL set';
  } catch {
    return String(url);
  }
}

/**
 * The fallback is silent **to the user** on purpose — "sign up first" is a coherent flow, not an
 * error screen, and a Supabase provider setting is an operator's problem, not theirs.
 *
 * It must never be silent to us. This warned about nothing on its first outing, so a disabled
 * toggle on the wrong project looked exactly like the feature working as designed, from the
 * outside and from the console. The reason and the project now both land in the log.
 */
export async function startAnonymousSession(): Promise<AnonymousStart> {
  try {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (!error && data.session) return 'ok';
    console.warn(
      `[cadence/auth] Anonymous onboarding is unavailable on ${projectHost()} — falling back to ` +
        'sign-up-first. To restore the gate-last flow, enable "Anonymous sign-ins" (Authentication → ' +
        `Sign In / Providers) on THAT project. Reason: ${error?.message ?? 'no session returned'}`,
    );
    return 'unavailable';
  } catch (err) {
    console.warn(`[cadence/auth] Anonymous onboarding threw on ${projectHost()} — falling back.`, err);
    return 'unavailable';
  }
}

/**
 * True while the current session belongs to someone who hasn't signed up yet.
 *
 * A linked identity outvotes the flag, and that is not belt-and-braces. Linking a provider to an
 * anonymous user is what makes it permanent, but whether the access token in hand already says so
 * depends on when it was minted — and the one place this is read is the sign-up gate, where a
 * stale `true` means someone who just signed in with Apple is shown the sign-up screen again. An
 * identity can only be there because they completed a provider flow, so it is the stronger signal.
 */
export function isAnonymousSession(
  session: { user?: { is_anonymous?: boolean; identities?: { provider?: string }[] | null } } | null,
): boolean {
  if (session?.user?.is_anonymous !== true) return false;
  const linked = session.user.identities ?? [];
  return !linked.some((i) => i.provider && i.provider !== 'anonymous');
}
