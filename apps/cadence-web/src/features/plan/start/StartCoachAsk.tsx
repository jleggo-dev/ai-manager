import { CoachFace } from '../../../components/CoachFace.tsx';
import type { SessionInsight } from '../../../lib/api.ts';
import { formatClock } from '../../../lib/clock.ts';
import { useClockUnit } from '../../../lib/query/index.ts';

/**
 * The top of the start sheet: Cadence asking the time question, and — at most — one thing Cadence
 * noticed.
 *
 * The insight slot holds ONE item or nothing, and nothing is the common case. A slot that always
 * has something in it is a slot people stop reading, and the only way to keep it always-full is
 * to start inventing observations. Everything that appears here is a read-back of the user's own
 * last answer or last log (see services/session-insight.ts) — Cadence never reports a measurement
 * never took.
 */
export function StartCoachAsk({
  title,
  timeOfDay,
  minutes,
  insight,
}: {
  title: string;
  timeOfDay?: string | null;
  minutes: number;
  insight: SessionInsight | null;
}) {
  // In the person's own clock (Settings → Units): "at 06:00" or "at 6:00 am".
  const clock = useClockUnit();
  const when = formatClock(timeOfDay, clock);
  return (
    <div className="sca">
      <div className="sca-say">
        <CoachFace size={52} />
        <div className="sca-bubble">
          {when ? `${title} at ${when} — ` : `${title} — `}
          {`have you got the full ${minutes} minutes, or shall we trim it together?`}
        </div>
      </div>

      {insight && (
        <div className="sca-insight">
          <div className="sca-insight-k">CADENCE NOTICED</div>
          <div className="sca-insight-t">{insight.text}</div>
        </div>
      )}
    </div>
  );
}
