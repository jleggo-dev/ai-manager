import { useState } from 'react';
import { capabilities } from '../../lib/capability/index.ts';
import { postHealthDigest } from '../../lib/api.ts';
import { buildDigestFromWorkouts, DIGEST_PERIOD_DAYS, HEALTH_OFFER_FLAG_KEY as FLAG_KEY } from './health-digest.ts';

/**
 * Confirm-first in-chat offer: read recent Apple Health activity so the user doesn't type
 * their workout history. Renders ONLY when the health capability is live (iOS shell) and the
 * user hasn't already answered. Accepting shows the native permission sheet right here in the
 * coach view; the digest is POSTed with the live sessionId so the coach can use it on the
 * very next reply. Copy rule: describe the behaviour, never the machinery (no "digest").
 */
type Phase = 'offer' | 'reading' | 'done' | 'empty' | 'error';

export function HealthOfferCard({ sessionId }: { sessionId: () => string | null }) {
  const [phase, setPhase] = useState<Phase>('offer');
  const [gone, setGone] = useState(false);

  if (gone) return null;

  async function accept() {
    setPhase('reading');
    try {
      await capabilities.health.requestPermissions(['workouts']);
      const since = new Date(Date.now() - DIGEST_PERIOD_DAYS * 86_400_000).toISOString();
      const workouts = await capabilities.health.getWorkouts(since);
      if (!workouts.length) {
        localStorage.setItem(FLAG_KEY, 'done');
        setPhase('empty');
        return;
      }
      const ok = await postHealthDigest(buildDigestFromWorkouts(workouts), sessionId());
      if (!ok) throw new Error('post failed');
      localStorage.setItem(FLAG_KEY, 'done');
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }

  function dismiss() {
    localStorage.setItem(FLAG_KEY, 'dismissed');
    setGone(true);
  }

  return (
    <div className="health-offer" role="group" aria-label="Apple Health">
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
        <>
          <p>Got it — I can see your recent activity now. Just keep talking.</p>
          <div className="health-offer-actions">
            <button className="btn-quiet" onClick={() => setGone(true)}>
              Close
            </button>
          </div>
        </>
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
          <p>I couldn&apos;t read Apple Health just now — we can try again from Settings any time.</p>
          <div className="health-offer-actions">
            <button className="btn-quiet" onClick={dismiss}>
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}
