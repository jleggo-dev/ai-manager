import { useEffect, useState } from 'react';
import { getReview, updateName } from '../../lib/api.ts';
import { Orb } from '../../components/Orb.tsx';

/**
 * Welcome / first-run — two lightweight beats instead of one crowded page: a one-line
 * hero (what Cadence is, in the brand's own words), then a single-question name screen.
 * A numbered "how it works" list read like a form, not a coach saying hello — cut it.
 */
type Stage = 'intro' | 'name';

export function Welcome({ onStart }: { onStart: () => void }) {
  const [stage, setStage] = useState<Stage>('intro');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill if this account already has a name (e.g. after switching to the "ongoing" account).
  useEffect(() => {
    getReview()
      .then((r) => r.name && setName(r.name))
      .catch(() => {
        /* fresh account */
      });
  }, []);

  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      const n = name.trim();
      if (n) await updateName(n); // store BEFORE opening the coach so the pack knows the name
    } catch {
      /* non-blocking — coach will ask if it's missing */
    }
    onStart();
  }

  return (
    <div className="welcome">
      <div className="hero">
        <Orb hero />
        <div className="w-word">Cadence</div>
        {stage === 'intro' ? (
          <p className="w-tag">
            <span className="accent">Just talk</span> — I'll help you build the routine you
            actually want.
          </p>
        ) : (
          <p className="w-tag w-ask">What should I call you?</p>
        )}
      </div>
      {stage === 'name' && (
        <div className="w-name">
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
            placeholder="Your name"
            aria-label="Your name"
            autoComplete="given-name"
            autoFocus
          />
        </div>
      )}
      <button className="cta" onClick={stage === 'intro' ? () => setStage('name') : start} disabled={busy}>
        {stage === 'intro' ? 'Get started →' : busy ? 'Starting…' : 'Continue →'}
      </button>
    </div>
  );
}
