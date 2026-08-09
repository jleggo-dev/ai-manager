import { Orb } from './Orb.tsx';

/**
 * "Cadence is working" — the mark, breathing, with two dots going round it.
 *
 * This is a shared component rather than a piece of the onboarding build screen because the wait
 * is not unique to onboarding: a plan rebuild, a weekly menu draft and a goal assessment are all
 * multi-second waits that currently each show something slightly different. One state for all of
 * them means a user learns the shape once and always knows the app is thinking rather than stuck.
 *
 * Reduced motion is honoured in CSS — the mark and the dots hold still, and the label still says
 * what is happening, which is the part that actually carries the meaning.
 */
export function CadenceWorking({
  size = 104,
  label,
  note,
}: {
  size?: number;
  /** What is being built, in the coach's voice ("Building your week…"). */
  label?: string;
  /** The line underneath — the specific work happening right now. */
  note?: string;
}) {
  return (
    <div className="cwork">
      <div className="cwork-mark" style={{ width: size, height: size }}>
        <div className="cwork-ball">
          <Orb />
        </div>
        <div className="cwork-orbit">
          <i className="cwork-dot cwork-day" />
        </div>
        <div className="cwork-orbit cwork-rev">
          <i className="cwork-dot cwork-night" />
        </div>
      </div>
      {label && (
        <div className="cwork-label" role="status">
          {label}
        </div>
      )}
      {note && <div className="cwork-note">{note}</div>}
    </div>
  );
}
