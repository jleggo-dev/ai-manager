import { Component, useState, type CSSProperties, type ReactNode } from 'react';
import { buildNextWeek } from '../../lib/api.ts';
import { Orb } from '../../components/Orb.tsx';

/**
 * The end of the trail (check-in rebuild, step 6) — DESIGN-check-in.md: "the horizon should end
 * where the week ends, and reaching it should be the moment the coach gets your attention." Two
 * independent layers, by owner's own review of the risk: a bug in the rich card must degrade to a
 * plain button, never to a blank week.
 *
 *  - `EndOfTrailFallback` (Layer 1) — plain text, two plain buttons, styled with nothing but
 *    inline styles so it has no CSS class or component dependency left to break.
 *  - `EndOfTrailCard` (Layer 2) — the rich card, the app's existing proposal-banner idiom
 *    (`.plan-proposal` etc. — see PlanProposalBanner.tsx), copy verbatim from the approved mockup.
 *  - `EndOfTrail` — what PlanView actually renders: gates on `show`, owns the "Just build my week"
 *    call (so both layers stay pure/presentational), and wraps Layer 2 in `EndOfTrailBoundary` so
 *    a render failure in the rich card falls back to Layer 1 instead of a blank week.
 */
interface EndOfTrailActions {
  onStartCheckIn: () => void;
  onJustBuild: () => void;
  busy: boolean;
}

const fallbackWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  alignItems: 'stretch',
  padding: '18px 4px',
  margin: '4px 0 16px',
};
const fallbackText: CSSProperties = { color: 'var(--text-dim, #6b7280)', fontSize: 14, textAlign: 'center' };
const fallbackPrimary: CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: 'none',
  fontWeight: 800,
  fontSize: 14,
  color: '#fff',
  background: 'var(--forest, #3f7a52)',
  cursor: 'pointer',
};
const fallbackSecondary: CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--forest, #3f7a52)',
  fontWeight: 700,
  fontSize: 14,
  color: 'var(--forest, #3f7a52)',
  background: 'transparent',
  cursor: 'pointer',
};

/**
 * Layer 1 — the fallback that cannot plausibly break. Driven by nothing more than the three
 * callbacks/flag it's handed; no state, no effects, no fetch of its own, no external CSS class.
 */
export function EndOfTrailFallback({ onStartCheckIn, onJustBuild, busy }: EndOfTrailActions) {
  return (
    <div style={fallbackWrap}>
      <p style={fallbackText}>That&rsquo;s the week. Check in, or just keep going?</p>
      <button type="button" style={fallbackPrimary} onClick={onStartCheckIn} disabled={busy}>
        Start check-in
      </button>
      <button type="button" style={fallbackSecondary} onClick={onJustBuild} disabled={busy}>
        {busy ? 'Building…' : 'Just build my week'}
      </button>
    </div>
  );
}

/**
 * Layer 2 — the rich card, in the app's existing proposal-banner idiom (PlanProposalBanner.tsx's
 * `.plan-proposal` family). Copy is verbatim from the approved mockup; nothing here narrates or
 * rephrases it.
 */
export function EndOfTrailCard({
  version,
  onStartCheckIn,
  onJustBuild,
  busy,
  error,
}: EndOfTrailActions & { version?: number; error: string | null }) {
  const title = version != null ? `Week ${version} wraps up today` : 'Your week wraps up today';
  return (
    <div className="plan-proposal eot-card">
      <Orb />
      <div className="plan-proposal-t">
        <b>{title}</b>
        <span>
          Let&rsquo;s have a check-in on how the week went, so I can tailor next week and ensure a smooth progression.
        </span>
        {error && <span className="eot-err">{error}</span>}
        <div className="proposal-actions">
          <button className="proposal-accept" onClick={onStartCheckIn} disabled={busy}>
            Start check-in
          </button>
          <button className="proposal-dismiss" onClick={onJustBuild} disabled={busy}>
            {busy ? 'Building…' : 'Just build my week'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Exported (not just internal) so the failure-mode test can mount it directly with a
 * deliberately-throwing child, rather than having to contrive a throw inside the real card.
 */
export class EndOfTrailBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    // A bug here must never read as a blank week — but it should still show up somewhere.
    console.error('[EndOfTrailCard] fell back to the plain end-of-trail', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * What PlanView actually renders. `show` is computed by the caller from two independent signals
 * OR'd together (`week.checkin_due` from the server, or the trail's own "nothing left past today"
 * read) — either can fire this on its own. Owns the "Just build my week" call and its busy/error
 * state so both presentational layers above stay pure; "Start check-in" is synchronous (the
 * caller's own coach bridge) and needs none of that.
 */
export function EndOfTrail({
  show,
  version,
  onStartCheckIn,
  onBuilt,
}: {
  show: boolean;
  version?: number;
  onStartCheckIn: () => void;
  onBuilt: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!show) return null;

  async function justBuild() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await buildNextWeek();
      if (r.status === 'committed') onBuilt();
      else setError("Couldn't build your next week just now — try again in a moment.");
    } catch {
      setError("Couldn't build your next week just now — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EndOfTrailBoundary
      fallback={<EndOfTrailFallback onStartCheckIn={onStartCheckIn} onJustBuild={justBuild} busy={busy} />}
    >
      <EndOfTrailCard
        version={version}
        onStartCheckIn={onStartCheckIn}
        onJustBuild={justBuild}
        busy={busy}
        error={error}
      />
    </EndOfTrailBoundary>
  );
}
