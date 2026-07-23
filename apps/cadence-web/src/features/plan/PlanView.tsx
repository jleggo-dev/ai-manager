import { useEffect, useState } from 'react';
import { OccurrenceSheet } from './OccurrenceSheet.tsx';
import { AdjustSheet } from './AdjustSheet.tsx';
import { TodayDashboard } from '../today/TodayDashboard.tsx';
import { PlanAdjustNote, PlanProposalBanner } from './PlanProposalBanner.tsx';
import { PlanWeekPanel } from './PlanWeekPanel.tsx';
import {
  getPlan,
  setOccurrence,
  acceptProposal,
  dismissProposal,
  type PlanViewData,
  type PlanOccurrence,
} from '../../lib/api.ts';

/**
 * The "Today" TAB — rendered inside MainTabs' .app shell (no header of its own). A pinned
 * `Today | Week` segment (S6) switches between two views over one loaded plan:
 *   • Today → the Visual Today dashboard (module cards: rhythm, macro rings, consistency rings,
 *     dot rows, counts, milestones) — the default, "plan for today"-first.
 *   • Week  → the rolling week list with per-day check-off.
 * Both share the coach proposal banner, the session sheets, and "Adjust my plan" (a slim pill
 * that pops the AdjustSheet: steer → preview → confirm) — suggest-never-auto-apply as always.
 * `reloadKey` bumps when a log/meal/adjust lands so the dashboard's aux fetches refresh.
 */
export function PlanView() {
  const [data, setData] = useState<PlanViewData | null>(null);
  const [view, setView] = useState<'today' | 'week'>('today');
  const [note, setNote] = useState('');
  const [proposalBusy, setProposalBusy] = useState(false);
  const [sheetOcc, setSheetOcc] = useState<string | null>(null); // open session sheet (occurrence id)
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSteer, setAdjustSteer] = useState(''); // pre-filled request (nutrition baseline → Adjust)
  const [adjustMode, setAdjustMode] = useState<'adjust' | 'rebalance'>('adjust');
  const [reloadKey, setReloadKey] = useState(0); // bumps → dashboard refetches /progress + /nutrition/day

  useEffect(() => {
    getPlan()
      .then(setData)
      .catch(() =>
        setData({ hasPlan: false, stage: 'new', activities: [], week: [], consistency: { kept: 0, window: 7 } }),
      );
  }, []);

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

  return (
    <>
      <div className="seg" role="tablist" aria-label="Today or week">
        <button
          className={`seg-btn${view === 'today' ? ' seg-on' : ''}`}
          role="tab"
          aria-selected={view === 'today'}
          onClick={() => setView('today')}
        >
          Today
        </button>
        <button
          className={`seg-btn${view === 'week' ? ' seg-on' : ''}`}
          role="tab"
          aria-selected={view === 'week'}
          onClick={() => setView('week')}
        >
          Week
        </button>
      </div>
      <div className="scrollbody">
        {data.pendingProposal && (
          <PlanProposalBanner
            proposal={data.pendingProposal}
            busy={proposalBusy}
            onAccept={acceptProp}
            onDismiss={dismissProp}
          />
        )}
        {note && <PlanAdjustNote note={note} onDismiss={() => setNote('')} />}

        {view === 'today' ? (
          <TodayDashboard plan={data} reloadKey={reloadKey} onCheck={set} onOpen={setSheetOcc} />
        ) : (
          <PlanWeekPanel
            today={today}
            rest={rest}
            kept={kept}
            windowDays={window}
            onCheck={set}
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
