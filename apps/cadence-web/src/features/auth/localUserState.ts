/**
 * Local state that belongs to a PERSON, not to a phone — and what to do when the person changes.
 *
 * Everything here lives in localStorage, which is scoped to the origin. That was fine when a
 * device meant a user. It stopped being true the moment onboarding could start over (a sign-out
 * that mints a brand-new anonymous identity) and the device could hold several accounts at once.
 *
 * It was reported the honest way: *"I restarted the onboarding flow — that previous dismissal
 * maybe shouldn't have applied? There's no way of knowing I'm the same user, is there?"* There
 * isn't, and there shouldn't be. An anonymous identity is unrecoverable by design; someone who
 * starts over is a different user, and inheriting the last one's answers is the app claiming to
 * recognise somebody it cannot.
 *
 * The concrete damage was an Apple Health offer dismissed by a previous identity suppressing the
 * card for a new one — and, worse in principle, `cadence.pushToken` handing one person's device
 * token to the next.
 *
 * NOT listed here, on purpose: the device-account roster and the dev-account switch. Those really
 * are facts about this phone ("who has signed in here"), and wiping them on every identity change
 * would defeat the feature they exist for.
 */

/** Whose answers the keys below currently hold. */
const LAST_USER_KEY = 'cadence.lastUserId';

export const USER_SCOPED_KEYS = [
  'cadence.healthOffer',
  'cadence.healthRefreshAt',
  // Whether the one-time Apple Health steps re-ask has happened (lib/capability/health-steps.ts).
  // User-scoped like the offer itself: a new identity has granted nothing, so inheriting "already
  // asked" would leave them permanently step-blind with no prompt to fix it.
  'cadence.healthStepsAsked',
  'cadence.journalDisclosed',
  'cadence.locationOffer.dismissed',
  'cadence.pushToken',
  // The locally cached coach transcript (coach-transcript-cache.ts), kept so the Coach tab paints
  // before the network answers. The most personal thing on this list by a distance: inheriting it
  // would open one person's coaching conversation in front of the next person to use the phone.
  'cadence.coachTranscript',
] as const;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode / storage disabled — treat as "nothing remembered"
  }
}

/**
 * Point local state at `userId`, clearing anything the previous person left behind.
 *
 * Returns whether it cleared, for tests and logging.
 *
 * A first run with nothing recorded ADOPTS the current user rather than clearing: on the build
 * that introduces this key, existing state has no owner recorded, and wiping it would re-ask
 * everyone their Health and journal questions for no reason. Only a genuine change clears.
 */
export function syncLocalStateToUser(userId: string | null): boolean {
  if (!userId) return false; // signed out — the next sign-in decides, and may be the same person
  const previous = read(LAST_USER_KEY);
  try {
    if (previous === userId) return false;
    if (previous !== null) for (const key of USER_SCOPED_KEYS) window.localStorage.removeItem(key);
    window.localStorage.setItem(LAST_USER_KEY, userId);
    return previous !== null;
  } catch {
    return false;
  }
}
