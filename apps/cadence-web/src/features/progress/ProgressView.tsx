import { useState } from 'react';
import type { ProgressWindow } from '@cadence/shared';
import { JournalStore } from '../journal/JournalStore.tsx';
import { useProgressLayout } from '../../lib/query/index.ts';
import { BoundWidget } from './BoundWidget.tsx';
import { SessionListScreen } from './SessionListScreen.tsx';
import { WindowSeg } from './WindowSeg.tsx';
import { ProgressSkeleton } from './ProgressSkeleton.tsx';

/**
 * The Progress tab (Progress Engine W1-6) — the page renders whatever the layout says, and the
 * layout is either the user's committed composition or the deterministic default the composer
 * derives from their goals (docs/cadence/PROGRESS-ENGINE.md). Section order IS the layout's
 * order: a practice-led user's page leads with a shelf and totals, no time axis — the layout
 * spec orders sections, it never imposes a timeline. All numbers are computed server-side; no
 * LLM anywhere on this surface, and the Week/Month/All control is a database read, never a
 * model call.
 */

/** The journal's home (Journal v2 §3): one quiet row — words in, words back; never analyzed. */
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

/** The door to the progress talk (Wave 3 makes it a scoped conversation; today it hands the
 *  coach a note the same way PlanView does — same coach, different room). */
function TalkRow({ onCoach }: { onCoach?: (note: string) => void }) {
  if (!onCoach) return null;
  return (
    <button
      className="adhoc-trigger"
      style={{ marginTop: 14 }}
      onClick={() =>
        onCoach(
          'They opened the progress talk from the Progress page — they want to change or understand what the page watches. Ask what progress means to them.',
        )
      }
    >
      <b style={{ fontWeight: 600 }}>Want this page to watch something different?</b>
      <span style={{ display: 'block', marginTop: 2 }}>
        tell me what progress means to you — we&rsquo;ll shape it together
      </span>
    </button>
  );
}

export function ProgressView({ onCoach }: { onCoach?: (note: string) => void }) {
  const [journalOpen, setJournalOpen] = useState(false);
  const [window, setWindow] = useState<ProgressWindow>('month');
  const [drill, setDrill] = useState<string | null>(null);
  const { data: layout, error } = useProgressLayout();

  if (drill) return <SessionListScreen activity={drill} onBack={() => setDrill(null)} />;

  if (error && !layout) {
    return (
      <div className="scrollbody">
        <div className="wiz-empty" style={{ marginTop: 24 }}>
          {"Couldn't load your progress just now — hop to another tab and back."}
        </div>
      </div>
    );
  }

  return (
    <div className="scrollbody">
      <div className="screen-title" style={{ marginTop: 10 }}>
        Progress
      </div>
      <div style={{ margin: '12px 0 4px' }}>
        <WindowSeg value={window} onChange={setWindow} />
      </div>
      {/* Present before the layout resolves; words don't wait for data. */}
      <JournalRow onOpen={() => setJournalOpen(true)} />
      {journalOpen && <JournalStore onClose={() => setJournalOpen(false)} />}
      {!layout ? (
        <ProgressSkeleton />
      ) : layout.sections.length === 0 ? (
        <div className="screen-sub">
          Nothing to show yet — as you log things with me, whatever we count together gathers here.
        </div>
      ) : (
        layout.sections.map((spec) => <BoundWidget key={spec.id} spec={spec} window={window} onDrill={setDrill} />)
      )}
      <TalkRow onCoach={onCoach} />
    </div>
  );
}
