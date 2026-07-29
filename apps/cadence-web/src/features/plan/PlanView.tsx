import { useEffect, useState } from 'react';
import { OccurrenceSheet } from './OccurrenceSheet.tsx';
import { StartSheet } from './StartSheet.tsx';
import { CaptureSheet } from './CaptureSheet.tsx';
import { CookSheet } from './CookSheet.tsx';
import { AdjustSheet } from './AdjustSheet.tsx';
import { taskOpener } from './taskShape.ts';
import { TodayTrail } from '../today/TodayTrail.tsx';
import { TrailHeader } from '../today/TrailHeader.tsx';
import { TodayFoodSheet } from '../nutrition/TodayFoodSheet.tsx';
import { PlanAdjustNote, PlanProposalBanner } from './PlanProposalBanner.tsx';
import { PlanWeekPanel } from './PlanWeekPanel.tsx';
import {
  getPlan,
  setOccurrence,
  logAdhoc,
  enterEpisode,
  endEpisode,
  checkin,
  acceptProposal,
  dismissProposal,
  type PlanViewData,
  type PlanOccurrence,
  type ActiveEpisode,
} from '../../lib/api.ts';

/** Warm label for a detour type — the coach names the disruption plainly (BRAND.md). */
function detourLabel(type: ActiveEpisode['type']): string {
  return {
    travel: 'traveling',
    illness: 'under the weather',
    injury: 'working around an injury',
    recovery: 'recovering',
    custom: 'a full stretch',
  }[type];
}

/**
 * The Today / Week surface — rendered inside MainTabs' .app shell (no header of its own). `view`
 * is controlled by the bottom nav (Today and Week are now sibling tabs, not a top segment):
 *   • Today → the Visual Today sky-trail (nodes, coach note, and the food strip → Today's food).
 *   • Week  → the rolling week list with per-day check-off.
 * Both share the coach proposal banner, the session sheets, and "Adjust my plan" (a slim pill
 * that pops the AdjustSheet: steer → preview → confirm) — suggest-never-auto-apply as always.
 * `reloadKey` bumps when a log/meal/adjust lands so the dashboard's aux fetches refresh.
 */
export function PlanView({
  onCoach,
  reloadSignal,
  view = 'today',
}: {
  onCoach: () => void;
  reloadSignal?: number;
  view?: 'today' | 'week';
}) {
  const [data, setData] = useState<PlanViewData | null>(null);
  const [note, setNote] = useState('');
  const [proposalBusy, setProposalBusy] = useState(false);
  const [sheetOcc, setSheetOcc] = useState<string | null>(null); // open session sheet (occurrence id)
  const [startOcc, setStartOcc] = useState<string | null>(null); // redesign start sheet (stepped task)
  const [captureOcc, setCaptureOcc] = useState<string | null>(null); // capture sheet (weigh-in / meal)
  const [foodOpen, setFoodOpen] = useState(false); // "Today's food" sheet (2F), opened from the trail strip
  const [foodSub, setFoodSub] = useState<'home' | 'shop'>('home'); // which sub-view the food sheet opens to
  const [cookOcc, setCookOcc] = useState<string | null>(null); // cook walkthrough (menu-derived cook task)
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSteer, setAdjustSteer] = useState(''); // pre-filled request (nutrition baseline → Adjust)
  const [adjustMode, setAdjustMode] = useState<'adjust' | 'rebalance'>('adjust');
  const [, setReloadKey] = useState(0); // bumps → aux refetch after a log/adjust (kept for callbacks)

  // Refetch on mount AND whenever the parent bumps reloadSignal (a ＋ FAB log just landed).
  useEffect(() => {
    getPlan()
      .then(setData)
      .catch(() =>
        setData({ hasPlan: false, stage: 'new', activities: [], week: [], consistency: { kept: 0, window: 7 } }),
      );
  }, [reloadSignal]);

  const refresh = () =>
    getPlan()
      .then(setData)
      .catch(() => {});
  const bump = () => setReloadKey((k) => k + 1);

  async function acceptProp() {
    if (proposalBusy) return;
    setProposalBusy(true);
    setNote('');
    try {
      const r = await acceptProposal();
      setData((d) => (d ? { ...d, pendingProposal: null } : d));
      if (r.status === 'committed') {
        setNote(r.note?.trim() || 'Updated your plan to fit how this stretch has been going.');
        setData(await getPlan());
        bump();
      } else if (r.status === 'entered_disrupted') {
        setData(await getPlan()); // the detour banner + paused overlay appear — that's the feedback
        bump();
      } else {
        setNote("I couldn't adjust it just now — give it another try in a bit.");
      }
    } catch {
      setNote('Something hiccuped on my end — try again in a moment.');
    } finally {
      setProposalBusy(false);
    }
  }

  function dismissProp() {
    setData((d) => (d ? { ...d, pendingProposal: null } : d));
    dismissProposal().catch(() => {});
  }

  async function set(o: PlanOccurrence, next: 'done' | 'skipped' | 'pending') {
    setData((d) =>
      d
        ? {
            ...d,
            week: d.week.map((day) => ({
              ...day,
              occurrences: day.occurrences.map((x) =>
                x.occurrence_id === o.occurrence_id ? { ...x, status: next } : x,
              ),
            })),
          }
        : d,
    );
    await setOccurrence(o.occurrence_id, next).catch(() => {});
    refresh(); // reconcile + refresh consistency
  }

  async function adhocLog(text: string) {
    await logAdhoc(text).catch(() => {});
    refresh(); // the off-plan entry shows in the week + moves consistency/streak
    bump();
  }

  async function enterDetour(type: ActiveEpisode['type']) {
    await enterEpisode(type).catch(() => {});
    refresh(); // base plan pauses; the detour banner + lighter options appear
    bump();
  }

  async function endDetour() {
    await endEpisode().catch(() => {});
    refresh(); // base plan resumes; the banner clears
    bump();
  }

  async function checkInNow() {
    await checkin().catch(() => {});
    refresh(); // keeps the streak alive even with nothing completed
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

  if (!data.hasPlan) {
    return (
      <div className="scrollbody">
        <div className="wiz-empty" style={{ marginTop: 24 }}>
          No plan yet — talk to your coach to set your rhythm.
        </div>
      </div>
    );
  }

  const today = data.week.find((d) => d.isToday);
  const rest = data.week.filter((d) => !d.isToday);
  const { kept, window } = data.consistency;
  const doneCount = data.week.reduce((n, d) => n + d.occurrences.filter((o) => o.status === 'done').length, 0);
  const xp = doneCount * 10; // stopgap XP until the REQ8 points finalize is wired to the plan response

  // Trail node tap → routed by task shape: captures (weigh-in, meals) open the minimal CaptureSheet;
  // coach sessions open the StartSheet walkthrough. (The Week view keeps its own OccurrenceSheet.)
  const openTask = (occ: PlanOccurrence) => {
    switch (taskOpener(occ)) {
      case 'task':
        return setStartOcc(occ.occurrence_id);
      case 'cook':
        return setCookOcc(occ.occurrence_id);
      case 'shop':
        setFoodSub('shop');
        return setFoodOpen(true);
      default: // weigh + meal
        return setCaptureOcc(occ.occurrence_id);
    }
  };

  return (
    <>
      <TrailHeader streak={data.streak?.current ?? 0} xp={xp} />
      <div className="scrollbody">
        {data.pendingProposal && (
          <PlanProposalBanner
            proposal={data.pendingProposal}
            busy={proposalBusy}
            onAccept={acceptProp}
            onDismiss={dismissProp}
          />
        )}
        {data.activeEpisode && (
          <div className="detour">
            <div className="detour-t">
              <b>On a detour — {detourLabel(data.activeEpisode.type)}</b>
              <span>
                Your plan&apos;s on hold so a rough stretch never breaks your rhythm. Do what you can — checking in
                keeps your streak alive.
              </span>
            </div>
            <div className="detour-actions">
              <button className="adjust-pill" onClick={checkInNow}>
                Check in
              </button>
              <button className="detour-end" onClick={endDetour}>
                I&apos;m back
              </button>
            </div>
          </div>
        )}
        {note && <PlanAdjustNote note={note} onDismiss={() => setNote('')} />}

        {view === 'today' ? (
          <TodayTrail
            plan={data}
            onOpen={openTask}
            onOpenFood={() => {
              setFoodSub('home');
              setFoodOpen(true);
            }}
            onCoach={onCoach}
          />
        ) : (
          <PlanWeekPanel
            today={today}
            rest={rest}
            kept={kept}
            windowDays={window}
            streak={data.streak}
            onCheck={set}
            onAdhocLog={adhocLog}
            onEnterDetour={data.activeEpisode ? undefined : enterDetour}
            onOpen={setSheetOcc}
            onAdjust={() => {
              setAdjustSteer('');
              setAdjustMode('adjust');
              setAdjustOpen(true);
            }}
            onRebalance={() => {
              setAdjustSteer('');
              setAdjustMode('rebalance');
              setAdjustOpen(true);
            }}
          />
        )}
      </div>
      {sheetOcc && (
        <OccurrenceSheet
          occurrenceId={sheetOcc}
          onClose={() => setSheetOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
          onProposeChange={(steer) => {
            // Baseline → Adjust bridge: the suggested change rides the normal steer→preview→confirm flow.
            setSheetOcc(null);
            setAdjustSteer(steer);
            setAdjustMode('adjust');
            setAdjustOpen(true);
          }}
        />
      )}
      {startOcc && (
        <StartSheet
          occurrenceId={startOcc}
          onClose={() => setStartOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
        />
      )}
      {captureOcc && (
        <CaptureSheet
          occurrenceId={captureOcc}
          onClose={() => setCaptureOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
        />
      )}
      {foodOpen && (
        <TodayFoodSheet
          date={data.week.find((d) => d.isToday)?.date ?? new Date().toISOString().slice(0, 10)}
          initialSub={foodSub}
          onClose={() => setFoodOpen(false)}
          onLogged={() => {
            refresh();
            bump();
          }}
        />
      )}
      {cookOcc && (
        <CookSheet
          occurrenceId={cookOcc}
          onClose={() => setCookOcc(null)}
          onLogged={() => {
            refresh();
            bump();
          }}
        />
      )}
      {adjustOpen && (
        <AdjustSheet
          initialSteer={adjustSteer}
          mode={adjustMode}
          onClose={() => setAdjustOpen(false)}
          onCommitted={(n) => {
            setNote(n);
            refresh();
            bump();
          }}
        />
      )}
    </>
  );
}
