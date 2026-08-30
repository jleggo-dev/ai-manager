import type { DatedSessionListItem } from '../../lib/api.ts';
import { useDatedSessions } from '../../lib/query/index.ts';

/**
 * The `dated_sessions` drill-down (Progress Engine W1-3, PROGRESS-ENGINE.md — "the dated session
 * list, A8's ruling: the list, not the average"). Standalone: takes `activity` + `onBack` and
 * fetches its own data, so integration (W1-6) can mount it from wherever the widget's drill-down
 * link lives without this screen knowing about ProgressView or navigation.
 *
 * Reuses the History feed's `.hist-row` idiom (ProgressView.tsx) rather than inventing new CSS —
 * this parcel does not touch styles.css. `best` is the ONE place warm accent (`--dawn-4`) is
 * allowed here: an accomplishment, never a verdict on the rest.
 */
export function SessionListScreen({ activity, onBack }: { activity: string; onBack: () => void }) {
  const { data, error } = useDatedSessions(activity, 'all');

  return (
    <div className="js" role="dialog" aria-label={activity}>
      <div className="js-bar">
        <button className="jw-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div>
          <div className="screen-title">{activity}</div>
          {data && <div className="screen-sub">{subtitle(data)}</div>}
        </div>
      </div>

      <div className="scrollbody">
        {error && !data && (
          <div className="wiz-empty">{"Couldn't load these sessions just now — try again shortly."}</div>
        )}
        {data && data.sessions.length === 0 && (
          <div className="wiz-empty">Nothing logged for {activity} yet — it will show up here once you do.</div>
        )}
        {data?.sessions
          .slice()
          .reverse() // newest first for reading; the payload itself stays ascending (the contract)
          .map((s, i) => (
            <SessionRow key={`${s.date}-${i}`} session={s} />
          ))}
      </div>
    </div>
  );
}

function subtitle(data: { total: number; last_4_weeks: number; usual_hr?: number | null }): string {
  const parts = [`${data.total} logged`, `${data.last_4_weeks} in the last 4 weeks`];
  // "absent HR simply absent" — never a 0 bpm reading, never shown until there's enough of them.
  if (typeof data.usual_hr === 'number' && data.usual_hr > 0)
    parts.push(`usually around ${Math.round(data.usual_hr)} bpm`);
  return parts.join(' · ');
}

/** "5.4 km · 31 min · right · 148 bpm" — compose only from the fields this session actually has;
 *  a missing distance/duration/felt/HR is simply absent, never a placeholder or a zero. */
function metricsLine(s: DatedSessionListItem): string {
  const parts: string[] = [];
  if (typeof s.distance_km === 'number' && s.distance_km > 0) parts.push(`${s.distance_km} km`);
  if (typeof s.duration_min === 'number' && s.duration_min > 0) parts.push(`${s.duration_min} min`);
  if (s.felt) parts.push(s.felt);
  if (typeof s.avg_hr === 'number' && s.avg_hr > 0) parts.push(`${Math.round(s.avg_hr)} bpm`);
  return parts.join(' · ');
}

function SessionRow({ session }: { session: DatedSessionListItem }) {
  const line = metricsLine(session);
  return (
    <div className="hist-row">
      <div className="hist-t">
        <b>{session.title}</b>
        {line && <span>{line}</span>}
        {/* The one place warm accent belongs on this widget (docs/cadence/PROGRESS-ENGINE.md
            brand physics: "accomplishments only"). */}
        {session.best && <span style={{ color: 'var(--dawn-4)', fontSize: 13.5 }}>your longest yet</span>}
      </div>
      <span className="hist-date">{session.date.slice(5)}</span>
    </div>
  );
}
