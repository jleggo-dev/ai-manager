import { useEffect, useState } from 'react';
import { fetchWeeklyRecap, setOccurrence, type OccurrenceDetail, type WeeklyRecap } from '../../../lib/api.ts';
import { WeighInPanel } from './WeighInPanel.tsx';

/**
 * "Your weekly check-in" — the room the door has been opening onto nothing.
 *
 * Until now this occurrence rendered the sentence "just tap it done when it happens", while the
 * `weekly_readout` job sat in config with no caller and `rollingConsistency` named a recap that did
 * not exist. This is both halves arriving: the week's figures, computed, and the coach's read of
 * them underneath.
 *
 * Two rules shape it. The FIGURES render whether or not the narration arrived — a coach call that
 * fails costs the paragraph, never the check-in. And the WEIGH-IN comes first when it is still
 * open, because a weigh-in at 08:00 and a check-in at 20:00 were two Sunday tasks pretending not
 * to be one (DESIGN-PROMPT-food-plan.md's closing question).
 */
export function RecapPanel({
  detail,
  setDetail,
  onLogged,
}: {
  detail: OccurrenceDetail;
  setDetail: (d: OccurrenceDetail) => void;
  onLogged?: () => void;
}) {
  const [recap, setRecap] = useState<WeeklyRecap | null>(null);
  const [busy, setBusy] = useState(true);
  const [closing, setClosing] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetchWeeklyRecap();
        if (live) setRecap(r);
      } catch {
        if (live) setErr("I couldn't put your week together just now — close and tap it again in a moment.");
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (busy) return <div className="sheet-msg">Looking back over your week…</div>;
  if (err || !recap) return <div className="sheet-msg">{err || 'No week to show yet.'}</div>;

  const weighInOpen = recap.weigh_in?.pending && recap.weigh_in.occurrence_id !== detail.occurrence_id;

  return (
    <div className="recap">
      {/* The scale first when it is still owed — one Sunday moment, not two. */}
      {weighInOpen && (
        <div className="recap-weigh">
          <div className="recap-k">FIRST, THE SCALE</div>
          <WeighInPanel
            detail={{ ...detail, occurrence_id: recap.weigh_in!.occurrence_id }}
            setDetail={() => setRecap({ ...recap, weigh_in: { ...recap.weigh_in!, pending: false } })}
            onLogged={onLogged}
          />
        </div>
      )}

      <div className="recap-figs">
        <div className="recap-fig">
          <b>
            {recap.consistency.kept} of {recap.consistency.window}
          </b>
          <span>days you showed up</span>
        </div>
        {recap.nutrition && (
          <div className="recap-fig">
            <b>
              {recap.nutrition.days_logged} of {recap.nutrition.days_in_window}
            </b>
            <span>days logged</span>
          </div>
        )}
        {recap.nutrition?.avg_kcal != null && (
          <div className="recap-fig">
            <b>~{recap.nutrition.avg_kcal}</b>
            <span>
              kcal on the {recap.nutrition.days_counted} day{recap.nutrition.days_counted === 1 ? '' : 's'} we could
              count
              {recap.nutrition.target_kcal != null ? ` · aiming ${recap.nutrition.target_kcal}` : ''}
            </span>
          </div>
        )}
        {recap.weight && (
          <div className="recap-fig">
            {/* The TREND, never this morning's number — that is what makes a scale survivable. */}
            <b>
              {recap.weight.actual_kg_per_week > 0 ? '+' : ''}
              {recap.weight.actual_kg_per_week} kg/wk
            </b>
            <span>
              {recap.weight.trend_kg != null ? `trending ~${recap.weight.trend_kg} kg` : 'your trend'}
              {recap.weight.confidence === 'low' ? ' · early days for this one' : ''}
            </span>
          </div>
        )}
      </div>

      {recap.episodes.length > 0 && (
        <div className="recap-k">
          {recap.episodes.length} detour{recap.episodes.length === 1 ? '' : 's'} in this week — counted, not held
          against you
        </div>
      )}

      {recap.note ? (
        <div className="recap-note">{recap.note}</div>
      ) : (
        <div className="recap-note recap-note-quiet">
          Here&apos;s your week in figures. I couldn&apos;t write it up just now — how did it actually feel?
        </div>
      )}

      <div className="recap-rolling">
        Over the last {recap.rolling.window} days: {recap.rolling.kept} days you showed up.
      </div>

      {detail.status === 'pending' && (
        <button
          type="button"
          className="logbox-btn"
          disabled={closing}
          onClick={() => {
            void (async () => {
              setClosing(true);
              try {
                await setOccurrence(detail.occurrence_id, 'done');
                setDetail({ ...detail, status: 'done' });
                onLogged?.();
              } catch {
                setErr("That didn't save — try again in a moment.");
              } finally {
                setClosing(false);
              }
            })();
          }}
        >
          {closing ? 'Noting it down…' : 'Read it — done ✓'}
        </button>
      )}
    </div>
  );
}
