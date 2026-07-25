import type { StreakView } from '@cadence/shared';
import { Orb } from '../../components/Orb.tsx';
import { OccurrenceRow } from '../../components/OccurrenceRow.tsx';
import type { PlanOccurrence, PlanViewData } from '../../lib/api.ts';

type PlanDay = PlanViewData['week'][number];

/** Week tab: consistency strip + today + remaining days + Adjust pill. */
export function PlanWeekPanel({
  today,
  rest,
  kept,
  windowDays,
  streak,
  onCheck,
  onOpen,
  onAdjust,
  onRebalance,
}: {
  today: PlanDay | undefined;
  rest: PlanDay[];
  kept: number;
  windowDays: number;
  streak?: StreakView;
  onCheck: (o: PlanOccurrence, next: 'done' | 'skipped' | 'pending') => void;
  onOpen: (id: string) => void;
  onAdjust: () => void;
  onRebalance: () => void;
}) {
  // A warm secondary note under the honest "N of 7" line — the protected streak, in the brand's
  // "rhythm" language (never a scoreboard). Hidden below 2 days so a single day isn't celebrated.
  const rhythmLine =
    streak && streak.current >= 2
      ? `${streak.current}-day rhythm${streak.savedByFreeze ? ' — a freeze kept it going' : ''}${
          streak.freezes > 0 ? ` · ${streak.freezes} freeze${streak.freezes === 1 ? '' : 's'} banked` : ''
        }`
      : null;
  const weekRow = (o: PlanOccurrence) => (
    <OccurrenceRow key={o.occurrence_id} o={o} variant="week" onCheck={onCheck} onOpen={onOpen} />
  );

  return (
    <>
      <div className="consist">
        <Orb />
        <div className="consist-t">
          <b>{kept === 0 ? 'A fresh week' : `You showed up ${kept} of ${windowDays} days`}</b>
          <span>
            {kept === 0
              ? 'Check things off as you go — a missed day is just information.'
              : 'Keep your rhythm — no pressure, no resets.'}
          </span>
          {rhythmLine && <span className="consist-streak">{rhythmLine}</span>}
        </div>
      </div>

      {today && (
        <div className="plan-day plan-today">
          <div className="pd-head">
            <b>Today</b>
            <span>
              {today.weekday} {today.dayNum}
            </span>
          </div>
          {today.occurrences.length === 0 ? (
            <div className="pd-empty">Nothing scheduled today — rest counts too.</div>
          ) : (
            today.occurrences.map((o) => weekRow(o))
          )}
        </div>
      )}

      <div className="plan-week-row">
        <div className="plan-week-label">The week ahead</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adjust-pill" onClick={onRebalance} title="Review every goal and rebalance the whole week">
            Rebalance
          </button>
          <button className="adjust-pill" onClick={onAdjust}>
            Adjust my plan
          </button>
        </div>
      </div>
      {rest.map((d) => (
        <div className="plan-day" key={d.date}>
          <div className="pd-head">
            <b>{d.weekday}</b>
            <span>{d.dayNum}</span>
          </div>
          {d.occurrences.length === 0 ? <div className="pd-empty">—</div> : d.occurrences.map((o) => weekRow(o))}
        </div>
      ))}
    </>
  );
}
