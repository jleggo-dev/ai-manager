import { Component, useState, type CSSProperties, type ReactNode } from 'react';
import { buildNextWeek, buildWeekAhead } from '../../lib/api.ts';
import { Orb } from '../../components/Orb.tsx';
import { endPhrase, localTodayIso } from './end-phrase.ts';

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
 *  - `EndOfTrail` — what PlanView actually renders: gates on `show`, owns the build call (so both
 *    layers stay pure/presentational), and wraps Layer 2 in `EndOfTrailBoundary` so a render
 *    failure in the rich card falls back to Layer 1 instead of a blank week.
 *
 * Two moments, one card (`mode`):
 *  - `due` — the week is over. "Start check-in" / "Just build my week" (the trust path: the same
 *    rhythm rolls into a new week).
 *  - `ahead` — the week is still running, and the wall stands at its end with the days past it
 *    locked (owner, 2026-09-09: those days used to read as blank, with no sign they were waiting
 *    on the check-in and no way to build them out). "Start check-in" / "Build next week": the
 *    following week is written on the same rhythm and opens; the check-in stays exactly where it
 *    is and still asks when its day comes. Two routes, one card — the mode picks the call.
 */
export type EndOfTrailMode = 'due' | 'ahead';

interface EndOfTrailActions {
  onStartCheckIn: () => void;
  onJustBuild: () => void;
  busy: boolean;
  mode?: EndOfTrailMode;
}

const BUILD_FAIL = "Couldn't build your next week just now — try again in a moment.";

const buildLabel = (mode: EndOfTrailMode) => (mode === 'ahead' ? 'Build next week' : 'Just build my week');

/**
 * "Wraps up today" is only true the day the trail's own edge is reached — someone who left it
 * sitting there for a week and a half comes back to a card confidently wrong about when its own
 * week ended. `endsOn` is `weekState.ends_on` (plan-view.ts's `computeWeekState`, YYYY-MM-DD); the
 * card only tips into the past tense once that date is clearly behind us (≥2 days), so an ordinary
 * same-day or one-day-late visit still reads exactly as it always has. Undefined/unparseable reads
 * as 0 — the present-tense default a caller not yet passing the date already gets today.
 */
function daysPastEnd(endsOn: string | undefined): number {
  const end = endsOn ? Date.parse(`${endsOn}T00:00:00Z`) : NaN;
  if (Number.isNaN(end)) return 0;
  return Math.floor((Date.now() - end) / 86_400_000);
}

/** The title's verb phrase. Due: today / wrapped up. Ahead: the day the week wraps, as a person
 *  would say it (end-phrase.ts) — "on Sunday", "tomorrow", "today" (the check-in's own day, before
 *  its hour comes); with no readable date, "soon". */
function wrapPhrase(mode: EndOfTrailMode, endsOn: string | undefined): string {
  if (mode === 'ahead') {
    const when = endPhrase(endsOn, localTodayIso());
    return when ? `wraps up ${when}` : 'wraps up soon';
  }
  return daysPastEnd(endsOn) >= 2 ? 'wrapped up' : 'wraps up today';
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
export function EndOfTrailFallback({ onStartCheckIn, onJustBuild, busy, mode = 'due' }: EndOfTrailActions) {
  return (
    <div style={fallbackWrap}>
      <p style={fallbackText}>
        {mode === 'ahead'
          ? 'The rest opens after your check-in. Check in, or build next week now?'
          : 'That’s the week. Check in, or just keep going?'}
      </p>
      <button type="button" style={fallbackPrimary} onClick={onStartCheckIn} disabled={busy}>
        Start check-in
      </button>
      <button type="button" style={fallbackSecondary} onClick={onJustBuild} disabled={busy}>
        {busy ? 'Building…' : buildLabel(mode)}
      </button>
    </div>
  );
}

/**
 * Layer 2 — the rich card, in the app's existing proposal-banner idiom (PlanProposalBanner.tsx's
 * `.plan-proposal` family). The due copy is verbatim from the approved mockup; nothing here
 * narrates or rephrases it.
 */
export function EndOfTrailCard({
  version,
  endsOn,
  onStartCheckIn,
  onJustBuild,
  busy,
  error,
  mode = 'due',
}: EndOfTrailActions & { version?: number; endsOn?: string; error: string | null }) {
  const verb = wrapPhrase(mode, endsOn);
  const title = version != null ? `Week ${version} ${verb}` : `Your week ${verb}`;
  return (
    <div className="plan-proposal eot-card">
      <Orb />
      <div className="plan-proposal-t">
        <b>{title}</b>
        {mode === 'ahead' ? (
          <span>
            The days past it open after your check-in, so I can tailor what comes next. Or I can build next week now on
            the same rhythm &mdash; your check-in stays where it is.
          </span>
        ) : (
          <span>
            Let&rsquo;s have a check-in on how the week went, so I can tailor next week and ensure a smooth progression.
          </span>
        )}
        {error && <span className="eot-err">{error}</span>}
        <div className="proposal-actions">
          <button className="proposal-accept" onClick={onStartCheckIn} disabled={busy}>
            Start check-in
          </button>
          <button className="proposal-dismiss" onClick={onJustBuild} disabled={busy}>
            {busy ? 'Building…' : buildLabel(mode)}
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
 * What PlanView actually renders. `show` is computed by the caller from independent signals
 * OR'd together (`week.checkin_due` from the server, the trail's own "nothing left past today"
 * read, or a locked day in view) — any can fire this on its own. Owns the build call and its
 * busy/error state so both presentational layers above stay pure; "Start check-in" is
 * synchronous (the caller's own coach bridge) and needs none of that.
 */
export function EndOfTrail({
  show,
  version,
  endsOn,
  mode = 'due',
  onStartCheckIn,
  onBuilt,
}: {
  show: boolean;
  version?: number;
  /** `weekState.ends_on` — optional so a caller not yet passing it keeps today's-tense copy. */
  endsOn?: string;
  /** Which moment this is — see the file comment. Defaults to the week being over. */
  mode?: EndOfTrailMode;
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
      // Ahead: next week written, check-in untouched. Due: the roll-forward, clock reset.
      const landed =
        mode === 'ahead'
          ? ['built', 'already_built'].includes((await buildWeekAhead()).status)
          : (await buildNextWeek()).status === 'committed';
      if (landed) onBuilt();
      else setError(BUILD_FAIL);
    } catch {
      setError(BUILD_FAIL);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EndOfTrailBoundary
      fallback={<EndOfTrailFallback onStartCheckIn={onStartCheckIn} onJustBuild={justBuild} busy={busy} mode={mode} />}
    >
      <EndOfTrailCard
        version={version}
        endsOn={endsOn}
        mode={mode}
        onStartCheckIn={onStartCheckIn}
        onJustBuild={justBuild}
        busy={busy}
        error={error}
      />
    </EndOfTrailBoundary>
  );
}
