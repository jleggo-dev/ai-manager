import { useEffect, useState } from 'react';
import type { ProgressWindow } from '@cadence/shared';
import { JournalStore } from '../journal/JournalStore.tsx';
import { useProgressLayout, usePlan } from '../../lib/query/index.ts';
import { BoundWidget } from './BoundWidget.tsx';
import { SessionListScreen } from './SessionListScreen.tsx';
import { PhotosRow, PhotosScreen } from './PhotosScreen.tsx';
import { WindowSeg } from './WindowSeg.tsx';
import { ProgressSkeleton } from './ProgressSkeleton.tsx';
import { ListScreen } from '../repertoire/ListScreen.tsx';

/**
 * The Progress tab (Progress Engine W1-6) — the page renders whatever the layout says, and the
 * layout is either the user's committed composition or the deterministic default the composer
 * derives from their goals (docs/cadence/PROGRESS-ENGINE.md). Section order IS the layout's
 * order: a practice-led user's page leads with a shelf and totals, no time axis — the layout
 * spec orders sections, it never imposes a timeline. All numbers are computed server-side; no
 * LLM anywhere on this surface, and the Week/Month/All control is a database read, never a
 * model call.
 */

/**
 * One quiet line (owner design 1a): flame chip, "N-day streak · longest was M", mono XP at the
 * right. Reads the shared /plan query cache (PERF-01) — the same numbers PlanView's TrailHeader
 * shows, including the `doneCount * 10` XP stopgap, so the two screens can never disagree. No
 * streak on file (or a current of 0) renders as absent — never a zero.
 */
function StreakLine() {
  const { data } = usePlan();
  const streak = data?.streak;
  if (!data?.hasPlan || !streak || streak.current < 1) return null;
  const doneCount = data.week.reduce((n, d) => n + d.occurrences.filter((o) => o.status === 'done').length, 0);
  const xp = doneCount * 10; // stopgap XP until the REQ8 points finalize is wired (same as PlanView)
  const longest = streak.longest > streak.current ? `longest was ${streak.longest}` : 'your longest yet';
  return (
    <div className="pw-streak">
      <span className="pw-streak-flame" aria-hidden>
        <svg viewBox="0 0 24 24" width="13" height="13">
          <path
            fill="currentColor"
            d="M12 3s4.5 3.6 4.5 8.2c0 1.4-.4 2.4-1 3.2.2-1.6-.4-3.2-1.6-4.2.3 3-1.4 4.3-2.4 5.6-.7.9-1 1.7-1 2.6 0 1.6 1.3 3 3 3-3.3 0-6-2.4-6-5.6C7.5 10.4 12 8.4 12 3Z"
          />
        </svg>
      </span>
      <span className="pw-streak-t">
        {streak.current}-day streak · {longest}
      </span>
      <span className="pw-streak-xp">{xp.toLocaleString()} XP</span>
    </div>
  );
}

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

export function ProgressView({
  onCoach,
  openRepertoire = false,
  onRepertoireOpened,
}: {
  onCoach?: (note: string) => void;
  /** Land straight on "What I'm learning", unscoped — the coach's seed receipt taps "Open ›" and
   *  the host switches to this tab with this set. It is the same drill-down `onOpenRepertoire`
   *  below opens, never a second screen. */
  openRepertoire?: boolean;
  /** Consumed — the host clears its request so coming back to this tab later lands on Progress
   *  itself, not on the list they already closed once. */
  onRepertoireOpened?: () => void;
}) {
  const [journalOpen, setJournalOpen] = useState(false);
  const [window, setWindow] = useState<ProgressWindow>('month');
  const [drill, setDrill] = useState<string | null>(null);
  const [photosOpen, setPhotosOpen] = useState(false);
  /** repertoire drill-down (P6 "the room"): which scope opened the list screen, or null when it
   *  is closed. `goalId` null means the card itself was unscoped ("everything they keep"). */
  const [repertoireScope, setRepertoireScope] = useState<{ goalId: string | null; goalName: string | null } | null>(
    openRepertoire ? { goalId: null, goalName: null } : null,
  );
  const { data: layout, error } = useProgressLayout();

  // The host's request, consumed once. It re-runs harmlessly after the clear (the flag is false by
  // then), so there is no ref latch to keep in step with the state it guards.
  useEffect(() => {
    if (!openRepertoire) return;
    setRepertoireScope((s) => s ?? { goalId: null, goalName: null });
    onRepertoireOpened?.();
  }, [openRepertoire, onRepertoireOpened]);
  // Shared /plan cache (PERF-01) — the header subline and StreakLine read it, never a new endpoint.
  const { data: plan } = usePlan();

  if (drill) return <SessionListScreen activity={drill} onBack={() => setDrill(null)} />;
  // "All photos live in Progress" (Settings Room design, 1e) — the settings toggle points here.
  if (photosOpen) return <PhotosScreen onBack={() => setPhotosOpen(false)} />;
  if (repertoireScope) {
    return (
      <ListScreen
        goalId={repertoireScope.goalId}
        goalName={repertoireScope.goalName}
        onBack={() => setRepertoireScope(null)}
        onOpenChat={onCoach}
      />
    );
  }

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
      <div className="pw-pagehead">
        <div className="pw-pagehead-t">
          <div className="pw-pagetitle">Progress</div>
          {plan?.hasPlan && plan.consistency.window > 0 && (
            <div className="pw-pagesub">
              showed up {plan.consistency.kept} of {plan.consistency.window} this week
            </div>
          )}
        </div>
        <WindowSeg value={window} onChange={setWindow} />
      </div>
      <StreakLine />
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
        layout.sections.map((spec) => (
          <BoundWidget
            key={spec.id}
            spec={spec}
            window={window}
            onDrill={setDrill}
            onOpenPhotos={() => setPhotosOpen(true)}
            onOpenRepertoire={(goalId, goalName) => setRepertoireScope({ goalId, goalName: goalName ?? null })}
          />
        ))
      )}
      <PhotosRow onOpen={() => setPhotosOpen(true)} />
      <TalkRow onCoach={onCoach} />
    </div>
  );
}
