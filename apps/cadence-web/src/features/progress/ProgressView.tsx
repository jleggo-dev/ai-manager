import { useEffect, useState } from 'react';
import type { ProgressTrend } from '@cadence/shared';
import { getProgress } from '../../lib/api.ts';
import { ProgressCardView, ProgressTrendCard } from '../../components/ProgressCards.tsx';
import { useGoalEventAdd } from '../today/useGoalEventAdd.ts';

/**
 * The Progress tab — "variable, coach-shaped" content that derives entirely from the user's
 * own goals and logged data (a no-fitness user simply has no fitness cards). Cards per goal,
 * trend sparklines per activity with ≥2 honest points, and a History feed. All numbers are
 * computed server-side (services/progress.ts); no LLM anywhere in this surface. Shared card
 * renderers live in components/ProgressCards.tsx (WEB-04).
 */

export function ProgressView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getProgress>> | null>(null);
  const [err, setErr] = useState(false);

  const load = () =>
    getProgress()
      .then(setData)
      .catch(() => setErr(true));

  const add = useGoalEventAdd(load);

  useEffect(() => {
    load();
  }, []);

  if (err) {
    return (
      <div className="scrollbody">
        <div className="wiz-empty" style={{ marginTop: 24 }}>
          Couldn't load your progress just now — hop to another tab and back.
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="scrollbody">
        <div className="chat-loading">
          <span className="typing">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    );
  }

  const empty = data.cards.length === 0 && data.trends.length === 0 && data.history.length === 0;

  return (
    <div className="scrollbody">
      {empty ? (
        <>
          <div className="screen-title" style={{ marginTop: 10 }}>
            Progress
          </div>
          <div className="screen-sub">
            Keep logging sessions and weigh-ins — your trends and wins will show up here as real data accumulates.
          </div>
        </>
      ) : (
        <>
          {data.cards.map((c, i) => (
            <ProgressCardView key={i} card={c} variant="progress" add={add} />
          ))}

          {data.trends.length > 0 && (
            <div className="plan-week-label" style={{ marginTop: 16 }}>
              Trends
            </div>
          )}
          {data.trends.map((t: ProgressTrend, i) => (
            <ProgressTrendCard key={`t${i}`} trend={t} variant="progress" />
          ))}

          {data.history.length > 0 && (
            <div className="plan-week-label" style={{ marginTop: 16 }}>
              History
            </div>
          )}
          {data.history.map((h, i) => (
            <div className="hist-row" key={`h${i}`}>
              <span className={`hist-dot${h.kind === 'event' ? ' hist-dot-event' : ''}`} />
              <div className="hist-t">
                <b>{h.kind === 'event' ? `🏁 ${h.title}` : h.title}</b>
                <span>{h.detail}</span>
              </div>
              <span className="hist-date">{h.at.slice(5)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
