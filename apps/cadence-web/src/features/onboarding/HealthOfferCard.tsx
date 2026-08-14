import { useState } from 'react';
import { CoachFace } from '../../components/CoachFace.tsx';
import { capabilities } from '../../lib/capability/index.ts';
import { postHealthDigest, postWorkoutHistory } from '../../lib/api.ts';
import {
  buildDigestFromWorkouts,
  DIGEST_PERIOD_DAYS,
  HEALTH_OFFER_FLAG_KEY as FLAG_KEY,
  toHistoryEntries,
} from './health-digest.ts';

/**
 * Confirm-first in-chat offer: read recent Apple Health activity so the user doesn't type
 * their workout history. Renders ONLY when the health capability is live (iOS shell) and the
 * user hasn't already answered. Accepting shows the native permission sheet right here in the
 * coach view; the digest is POSTed with the live sessionId so the coach can use it on the
 * very next reply. Copy rule: describe the behaviour, never the machinery (no "digest").
 *
 * **Sharing has to lead somewhere.** Handing over months of history and getting "just keep
 * talking" back is the app taking something and saying nothing — and the coach genuinely has it
 * by then, sitting unused in the session. `onShared` is how the card asks her to actually read
 * it out loud, which is the only reason the user agreed to any of this.
 *
 * She wears her face on every state, because every line on this card is her talking.
 */
type Phase = 'offer' | 'reading' | 'done' | 'empty' | 'error';

export function HealthOfferCard({
  sessionId,
  onShared,
}: {
  sessionId: () => string | null;
  /** Fired once the history is with her — the caller asks her to say what she makes of it. */
  onShared?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('offer');
  const [gone, setGone] = useState(false);

  if (gone) return null;

  async function accept() {
    setPhase('reading');
    try {
      await capabilities.health.requestPermissions(['workouts']);
      const since = new Date(Date.now() - DIGEST_PERIOD_DAYS * 86_400_000).toISOString();
      // Steps ride along, and must never take the workouts down with them (health-steps.ts).
      const [workouts, steps] = await Promise.all([
        capabilities.health.getWorkouts(since),
        capabilities.health.getDailySteps(since).catch(() => []),
      ]);
      // "No recorded workouts" is NOT "no activity". Somebody walking 16k steps a day and never
      // pressing start on a watch used to land here and share nothing at all — and then got a plan
      // built for someone sedentary. Any signal at all is worth sharing.
      if (!workouts.length && !steps.length) {
        window.localStorage.setItem(FLAG_KEY, 'done');
        setPhase('empty');
        return;
      }
      // Rows first (0033 dataset), best-effort — the digest is the promise the card makes, so
      // only ITS failure is allowed to surface as one.
      await postWorkoutHistory(toHistoryEntries(workouts)).catch(() => false);
      const ok = await postHealthDigest(buildDigestFromWorkouts(workouts, DIGEST_PERIOD_DAYS, steps), sessionId());
      if (!ok) throw new Error('post failed');
      window.localStorage.setItem(FLAG_KEY, 'done');
      setPhase('done');
      onShared?.();
    } catch (err) {
      // Fifth swallowed error in this feature, and the one that cost the most: "I couldn't read
      // Apple Health just now" is indistinguishable from a denied permission, a plugin throw and a
      // failed post, so there was nothing to act on from either side of the screen.
      console.error('[cadence/health] could not read Apple Health', err);
      setPhase('error');
    }
  }

  function dismiss() {
    window.localStorage.setItem(FLAG_KEY, 'dismissed');
    setGone(true);
  }

  return (
    <div className="health-offer" role="group" aria-label="Apple Health">
      <CoachFace size={30} className="health-offer-face" />
      {phase === 'offer' && (
        <>
          <p>I can look at your recent workouts in Apple Health, so you don&apos;t have to type your history — okay?</p>
          <div className="health-offer-actions">
            <button className="btn-primary" onClick={accept}>
              Yes, take a look
            </button>
            <button className="btn-quiet" onClick={dismiss}>
              Not now
            </button>
          </div>
        </>
      )}
      {phase === 'reading' && <p>Reading your recent activity…</p>}
      {phase === 'done' && (
        // No Close button: she is about to speak, so the card's job is done and dismissing it is
        // one more decision for no reason. It stays as the record of what was shared.
        <p>{'Got it — I can see your recent activity now. Give me a minute to look at it properly.'}</p>
      )}
      {phase === 'empty' && (
        <>
          <p>Nothing in Apple Health for the last few months — no problem, just tell me as we go.</p>
          <div className="health-offer-actions">
            <button className="btn-quiet" onClick={() => setGone(true)}>
              Close
            </button>
          </div>
        </>
      )}
      {phase === 'error' && (
        <>
          {/* No "open settings" button, deliberately. The plugin's openAppleHealthSettings lands
              on the app's OWN settings page, which does not list Health at all — iOS keeps per-app
              Health access somewhere else and offers no deep link to it. A button onto a page
              without the control is worse than words naming the right one. */}
          <p>
            I couldn&apos;t read Apple Health just now. Worth a look in Settings &rsaquo; Health &rsaquo; Data Access
            &amp; Devices &rsaquo; Cadence — or skip it and just tell me as we go.
          </p>
          <div className="health-offer-actions">
            <button className="btn-quiet" onClick={dismiss}>
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
