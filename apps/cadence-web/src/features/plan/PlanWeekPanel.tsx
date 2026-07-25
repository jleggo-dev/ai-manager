import { useState } from 'react';
import type { StreakView } from '@cadence/shared';
import { Orb } from '../../components/Orb.tsx';
import { OccurrenceRow } from '../../components/OccurrenceRow.tsx';
import type { PlanOccurrence, PlanViewData, ActiveEpisode } from '../../lib/api.ts';

type PlanDay = PlanViewData['week'][number];

/** The self-declare detour types (Req 4) — the coach names each plainly (BRAND.md). */
const DETOUR_TYPES: Array<{ type: ActiveEpisode['type']; label: string }> = [
  { type: 'travel', label: 'Traveling' },
  { type: 'illness', label: 'Unwell' },
  { type: 'injury', label: 'An injury' },
  { type: 'recovery', label: 'Recovering' },
  { type: 'custom', label: 'A rough stretch' },
];

/** Week tab: consistency strip + today + off-plan quick-log + take-a-detour + remaining days + Adjust. */
export function PlanWeekPanel({
  today,
  rest,
  kept,
  windowDays,
  streak,
  onCheck,
  onAdhocLog,
  onEnterDetour,
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
  onAdhocLog: (text: string) => Promise<void>;
  onEnterDetour?: (type: ActiveEpisode['type']) => Promise<void>; // absent while already on a detour
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

  const [composing, setComposing] = useState(false);
  const [adhocText, setAdhocText] = useState('');
  const [saving, setSaving] = useState(false);
  const [detourOpen, setDetourOpen] = useState(false);
  async function submitAdhoc() {
    const t = adhocText.trim();
    if (!t || saving) return;
    setSaving(true);
    try {
      await onAdhocLog(t);
      setAdhocText('');
      setComposing(false);
    } finally {
      setSaving(false);
    }
  }

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

      <div className="adhoc">
        {composing ? (
          <div className="adhoc-compose">
            <textarea
              className="adhoc-input"
              placeholder="What did you do? e.g. “hotel gym — 30 min, felt good”"
              value={adhocText}
              onChange={(e) => setAdhocText(e.target.value)}
              rows={2}
              autoFocus
            />
            <div className="adhoc-actions">
              <button className="adjust-pill" onClick={submitAdhoc} disabled={saving || !adhocText.trim()}>
                {saving ? 'Saving…' : 'Log it'}
              </button>
              <button
                className="adhoc-cancel"
                onClick={() => {
                  setComposing(false);
                  setAdhocText('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="adhoc-trigger" onClick={() => setComposing(true)}>
            + Log something off-plan
          </button>
        )}
      </div>

      {onEnterDetour && (
        <div className="detour-entry">
          {detourOpen ? (
            <div className="detour-pick">
              <span className="detour-pick-label">Take a detour — your plan pauses for a bit, it never resets.</span>
              <div className="detour-chips">
                {DETOUR_TYPES.map((d) => (
                  <button
                    key={d.type}
                    className="detour-chip"
                    onClick={() => {
                      void onEnterDetour(d.type);
                      setDetourOpen(false);
                    }}
                  >
                    {d.label}
                  </button>
                ))}
                <button className="adhoc-cancel" onClick={() => setDetourOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="detour-trigger" onClick={() => setDetourOpen(true)}>
              Life happened? Take a detour
            </button>
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
