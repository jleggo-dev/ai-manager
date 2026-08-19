import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase.ts';

/**
 * Accounts that have signed in on this device.
 *
 * **Why a roster at all.** A phone is shared, and a coach that makes you retype an email to get
 * back to your own plan is a coach that made you start over — the one thing the brand promises
 * never to do. So the returning screen is faces and names, and getting back in is one tap.
 *
 * **What is stored, and where.** Supabase already persists the *current* session — access token,
 * refresh token and all — in this origin's localStorage; that is how `persistSession` works. This
 * keeps a snapshot of the same material for the other accounts, so it is the same store and the
 * same exposure, not a new one. Nothing else is kept: a name, an email, and the portrait id, which
 * is what the picker draws.
 *
 * **Removing is signing out, not deleting.** A removed row loses its stored session and its place
 * in this list. The account, its plan and its history are untouched on the server — the copy under
 * the manage screen says exactly that, because a red minus next to your own face needs disarming.
 *
 * **A stored session can go stale** — refresh tokens rotate and expire. `resume` says so honestly
 * and the caller falls back to a normal sign-in rather than pretending the tap did nothing.
 */

const KEY = 'cadence.device-accounts.v1';

export interface DeviceAccount {
  userId: string;
  email: string | null;
  /** What the coach calls them, if we know it. */
  name: string | null;
  /** The portrait id they picked, for the row's avatar. Null → the mark. */
  faceId: string | null;
  /**
   * Which doors this account came through — 'google', 'apple', 'email'. What makes "sign back in
   * using the way you signed up" possible: without it an expired session dumped the owner at a
   * generic provider sheet, he tapped Apple, his account was Google+email, and Supabase minted a
   * fresh empty user — which then "restarted onboarding" (2026-08-19). Older rows lack the field;
   * readers treat that as unknown, never as none.
   */
  providers?: string[];
  /** Snapshot of the Supabase session, or null once it has been used up / removed. */
  refreshToken: string | null;
  accessToken: string | null;
  savedAt: number;
}

function read(): DeviceAccount[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list.filter((a) => a && typeof a === 'object') as DeviceAccount[]) : [];
  } catch {
    return [];
  }
}

function write(list: DeviceAccount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode / quota — the roster is a convenience, never a requirement */
  }
}

/**
 * Newest first, so the account you last used is the one under your thumb.
 *
 * Ordered by position, not by `savedAt`: `rememberDeviceAccount` re-appends the row it touched,
 * and two sign-ins in the same millisecond — which is exactly what a resume-then-remember does —
 * would tie on a timestamp sort and land in whatever order the array happened to be in.
 */
export function listDeviceAccounts(): DeviceAccount[] {
  return read().reverse();
}

/**
 * Record (or refresh) the signed-in account. Called whenever a session settles, so the stored
 * refresh token keeps up with rotation instead of going stale the first time it turns over.
 *
 * Anonymous users are deliberately NOT rostered: an account with no email is one nobody can
 * recognise on a returning screen, and offering it as "someone" to come back to is a lie.
 */
export function rememberDeviceAccount(
  session: Session,
  extra: { name?: string | null; faceId?: string | null } = {},
): void {
  const user = session.user;
  if (user.is_anonymous) return;
  const list = read().filter((a) => a.userId !== user.id);
  const prev = read().find((a) => a.userId === user.id);
  const meta = (user.app_metadata ?? {}) as { provider?: string; providers?: string[] };
  const providers =
    Array.isArray(meta.providers) && meta.providers.length
      ? meta.providers
      : meta.provider
        ? [meta.provider]
        : (prev?.providers ?? []);
  list.push({
    userId: user.id,
    email: user.email ?? null,
    name: extra.name ?? prev?.name ?? null,
    faceId: extra.faceId ?? prev?.faceId ?? null,
    providers,
    refreshToken: session.refresh_token ?? null,
    accessToken: session.access_token ?? null,
    savedAt: Date.now(),
  });
  write(list);
}

/** Update the display bits without touching the stored session. */
export function decorateDeviceAccount(userId: string, extra: { name?: string | null; faceId?: string | null }): void {
  const list = read();
  const row = list.find((a) => a.userId === userId);
  if (!row) return;
  if (extra.name !== undefined) row.name = extra.name;
  if (extra.faceId !== undefined) row.faceId = extra.faceId;
  write(list);
}

/** Sign an account out of THIS device. Nothing server-side is touched. */
export function forgetDeviceAccount(userId: string): void {
  write(read().filter((a) => a.userId !== userId));
}

/**
 * Drop the dead tokens and KEEP the person.
 *
 * Expiry used to call `forgetDeviceAccount`, on the reasoning that the picker should stop offering
 * a dead tap. The reasoning was wrong twice over. The tap is not dead — it just needs a password —
 * and deleting the row takes the name, the face and the email with it. The owner hit it on his own
 * phone (2026-08-16): *"it says 'that sign-in has expired' and it removed my name and account.
 * That shouldn't happen (even if the sign-in expired that shouldn't happen)."*
 *
 * He is right, and the cost is worse than an extra tap: a returning user sees their own face
 * vanish from a screen titled "Welcome back", which reads as the account being gone rather than the
 * session being stale. For an app whose promise is *never makes you start over*, that is the
 * cruellest possible false alarm.
 *
 * So the row stays, minus the tokens, and the picker offers to sign that person back in by name.
 */
export function expireDeviceAccount(userId: string): void {
  write(read().map((a) => (a.userId === userId ? { ...a, refreshToken: null, accessToken: null } : a)));
}

export type ResumeResult = 'ok' | 'expired' | 'unavailable';

/**
 * Come back to a rostered account. `expired` and `unavailable` both mean the same thing to the
 * caller — this person is known, and needs a password before they are back in. Neither forgets them.
 */
export async function resumeDeviceAccount(userId: string): Promise<ResumeResult> {
  const row = read().find((a) => a.userId === userId);
  if (!row?.refreshToken || !row.accessToken) return 'unavailable';
  const { data, error } = await supabase.auth.setSession({
    access_token: row.accessToken,
    refresh_token: row.refreshToken,
  });
  if (error || !data.session) {
    expireDeviceAccount(userId);
    return 'expired';
  }
  rememberDeviceAccount(data.session);
  return 'ok';
}
