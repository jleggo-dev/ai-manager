import { useState } from 'react';
import { JournalStore } from '../journal/JournalStore.tsx';
import type { ProgressTrend } from '@cadence/shared';
import { ProgressCardView, ProgressTrendCard } from '../../components/ProgressCards.tsx';
import { useGoalEventAdd } from '../today/useGoalEventAdd.ts';
import { useProgress } from '../../lib/query/index.ts';
import { ProgressSkeleton } from './ProgressSkeleton.tsx';

/**
 * The Progress tab — "variable, coach-shaped" content that derives entirely from the user's
 * own goals and logged data (a no-fitness user simply has no fitness cards). Cards per goal,
 * trend sparklines per activity with ≥2 honest points, and a History feed. All numbers are
 * computed server-side (services/progress.ts); no LLM anywhere in this surface. Shared card
 * renderers live in components/ProgressCards.tsx (WEB-04).
 */

/**
 * The journal's home (Journal v2 §3): one quiet row — the store is a full-screen page. Lifted out
 * of the render body so the loading branch can show it too: it reads nothing from the server, so
 * making it wait behind the dashboard's fetch was a small lie about how fast the app is.
 */
function JournalRow({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="journal-row" onClick={onOpen}>
      <span className="journal-row-t">
        <b>Your journal</b>
        <span>your words, as you wrote them</span>
      </span>
      <span aria-hidden>›</span>
    </button>
  );
}

export function ProgressView() {
  const [journalOpen, setJournalOpen] = useState(false);
  // Shared query cache (PERF-01): a tab return paints the cached dashboard instantly and
  // revalidates in the background; the skeleton is only for the first load of a session. A refetch
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
  // Structure first, numbers after (PERF-06). `/progress` is ~150ms of Postgres, so it gets the
  // dashboard's own card shapes rather than the coach's typing dots — the journal row above is
  // real from the first frame because it never waited on anything.
  if (!data) {
    return (
      <div className="scrollbody">
        <JournalRow onOpen={() => setJournalOpen(true)} />
        {/* The row is real, so the page it opens has to work while the dashboard is still in
            flight — a live-looking control that does nothing when tapped is worse than a bar. */}
        {journalOpen && <JournalStore onClose={() => setJournalOpen(false)} />}
        <ProgressSkeleton />
      </div>
    );
  }

  const empty = data.cards.length === 0 && data.trends.length === 0 && data.history.length === 0;

  return (
    <div className="scrollbody">
      {/* Present even when Progress is empty; words don't wait for fitness data. */}
      <JournalRow onOpen={() => setJournalOpen(true)} />
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
