import { useEffect, useState } from 'react';
import { Orb } from '../../components/Orb.tsx';
import { OccurrenceSheet } from './OccurrenceSheet.tsx';
import { AdjustSheet } from './AdjustSheet.tsx';
import { TodayDashboard } from '../today/TodayDashboard.tsx';
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
  const [reloadKey, setReloadKey] = useState(0); // bumps → dashboard refetches /progress + /nutrition/day

  useEffect(() => {
    getPlan().then(setData).catch(() => setData({ hasPlan: false, stage: 'new', activities: [], week: [], consistency: { kept: 0, window: 7 } }));
  }, []);

  const refresh = () => getPlan().then(setData).catch(() => {});
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
        ? { ...d, week: d.week.map((day) => ({ ...day, occurrences: day.occurrences.map((x) => (x.occurrence_id === o.occurrence_id ? { ...x, status: next } : x)) })) }
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
        <div className="wiz-empty" style={{ marginTop: 24 }}>No plan yet — talk to your coach to set your rhythm.</div>
      </div>
    );
  }

  const today = data.week.find((d) => d.isToday);
  const rest = data.week.filter((d) => !d.isToday);
  const { kept, window } = data.consistency;

  const Item = ({ o }: { o: PlanOccurrence }) => {
    const done = o.status === 'done';
    const skipped = o.status === 'skipped';
    // user rows open the session sheet; weigh-in / food-log system rows open their capture sheets.
    const openable = o.kind === 'user' || /weigh|food|meal|nutrition/i.test(o.title);
    return (
      <div className={`occ${done ? ' occ-done' : ''}${skipped ? ' occ-skip' : ''}`}>
        <button className="occ-check" onClick={() => set(o, done ? 'pending' : 'done')} aria-label={done ? 'Mark not done' : 'Mark done'}>
          {done ? '✓' : skipped ? '–' : ''}
        </button>
        {openable ? (
          <button className="occ-body occ-open" onClick={() => setSheetOcc(o.occurrence_id)} title="See the session">
            <span className="occ-title">{o.title}</span>
            {o.time_of_day && <span className="occ-time">{o.time_of_day}</span>}
          </button>
        ) : (
          <div className="occ-body">
            <span className="occ-title">{o.title}</span>
            {o.time_of_day && <span className="occ-time">{o.time_of_day}</span>}
          </div>
        )}
        {!done && (
          <button className="occ-skipbtn" onClick={() => set(o, skipped ? 'pending' : 'skipped')}>
            {skipped ? 'undo' : 'skip'}
          </button>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="seg" role="tablist" aria-label="Today or week">
        <button className={`seg-btn${view === 'today' ? ' seg-on' : ''}`} role="tab" aria-selected={view === 'today'} onClick={() => setView('today')}>Today</button>
        <button className={`seg-btn${view === 'week' ? ' seg-on' : ''}`} role="tab" aria-selected={view === 'week'} onClick={() => setView('week')}>Week</button>
      </div>
      <div className="scrollbody">
        {data.pendingProposal && (
          <div className="plan-proposal">
            <Orb />
            <div className="plan-proposal-t">
              <b>Your coach has a suggestion</b>
              <span>{data.pendingProposal.reason}</span>
              {data.pendingProposal.suggested_levers.length > 0 && (
                <div className="proposal-levers">
                  {data.pendingProposal.suggested_levers.map((lever, i) => (
                    <span className="lever-chip" key={i}>{lever}</span>
                  ))}
                </div>
              )}
              <div className="proposal-actions">
                <button className="proposal-accept" onClick={acceptProp} disabled={proposalBusy}>
                  {proposalBusy ? 'Adjusting…' : 'Adjust my plan'}
                </button>
                <button className="proposal-dismiss" onClick={dismissProp} disabled={proposalBusy}>
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}
        {note && (
          <div className="plan-note">
            <Orb />
            <div className="plan-note-t">
              <b>Your coach adjusted your plan</b>
              <span>{note}</span>
            </div>
            <button className="plan-note-x" onClick={() => setNote('')} aria-label="Dismiss">×</button>
          </div>
        )}

        {view === 'today' ? (
          <TodayDashboard plan={data} reloadKey={reloadKey} onCheck={set} onOpen={setSheetOcc} />
        ) : (
          <>
            <div className="consist">
              <Orb />
              <div className="consist-t">
                <b>{kept === 0 ? 'A fresh week' : `You showed up ${kept} of ${window} days`}</b>
                <span>{kept === 0 ? 'Check things off as you go — a missed day is just information.' : 'Keep your rhythm — no pressure, no resets.'}</span>
              </div>
            </div>

            {today && (
              <div className="plan-day plan-today">
                <div className="pd-head">
                  <b>Today</b>
                  <span>{today.weekday} {today.dayNum}</span>
                </div>
                {today.occurrences.length === 0 ? (
                  <div className="pd-empty">Nothing scheduled today — rest counts too.</div>
                ) : (
                  today.occurrences.map((o) => <Item key={o.occurrence_id} o={o} />)
                )}
              </div>
            )}

            <div className="plan-week-row">
              <div className="plan-week-label">The week ahead</div>
              <button className="adjust-pill" onClick={() => { setAdjustSteer(''); setAdjustOpen(true); }}>Adjust my plan</button>
            </div>
            {rest.map((d) => (
              <div className="plan-day" key={d.date}>
                <div className="pd-head">
                  <b>{d.weekday}</b>
                  <span>{d.dayNum}</span>
                </div>
                {d.occurrences.length === 0 ? <div className="pd-empty">—</div> : d.occurrences.map((o) => <Item key={o.occurrence_id} o={o} />)}
              </div>
            ))}
          </>
        )}
      </div>
      {sheetOcc && (
        <OccurrenceSheet
          occurrenceId={sheetOcc}
          onClose={() => setSheetOcc(null)}
          onLogged={() => { refresh(); bump(); }}
          onProposeChange={(steer) => {
            // Baseline → Adjust bridge: the suggested change rides the normal steer→preview→confirm flow.
            setSheetOcc(null);
            setAdjustSteer(steer);
            setAdjustOpen(true);
          }}
        />
      )}
      {adjustOpen && (
        <AdjustSheet
          initialSteer={adjustSteer}
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
