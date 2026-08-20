import { useState } from 'react';
import { JournalStore } from '../journal/JournalStore.tsx';
import type { ProgressTrend } from '@cadence/shared';
import { ProgressCardView, ProgressTrendCard } from '../../components/ProgressCards.tsx';
import { useGoalEventAdd } from '../today/useGoalEventAdd.ts';
import { useProgress } from '../../lib/query/index.ts';

/**
 * The Progress tab — "variable, coach-shaped" content that derives entirely from the user's
 * own goals and logged data (a no-fitness user simply has no fitness cards). Cards per goal,
 * trend sparklines per activity with ≥2 honest points, and a History feed. All numbers are
 * computed server-side (services/progress.ts); no LLM anywhere in this surface. Shared card
 * renderers live in components/ProgressCards.tsx (WEB-04).
 */

export function ProgressView() {
  const [journalOpen, setJournalOpen] = useState(false);
  // Shared query cache (PERF-01): a tab return paints the cached dashboard instantly and
  // revalidates in the background; the dots are only for the first load of a session. A refetch
  // that fails keeps the last good numbers on screen — the error card is for having nothing.
  const { data, error, refetch } = useProgress();

  const add = useGoalEventAdd(() => void refetch());

  if (error && !data) {
    return (
      <div className="scrollbody">
        <div className="wiz-empty" style={{ marginTop: 24 }}>
          {"Couldn't load your progress just now — hop to another tab and back."}
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
      {/* The journal's home (Journal v2 §3): one quiet row — the store is a full-screen page.
          Present even when Progress is empty; words don't wait for fitness data. */}
      <button className="journal-row" onClick={() => setJournalOpen(true)}>
        <span className="journal-row-t">
          <b>Your journal</b>
          <span>your words, as you wrote them</span>
        </span>
        <span aria-hidden>›</span>
      </button>
      {journalOpen && <JournalStore onClose={() => setJournalOpen(false)} />}
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
