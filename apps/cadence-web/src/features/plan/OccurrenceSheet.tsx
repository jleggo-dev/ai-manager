import { useMemo, useState, type CSSProperties } from 'react';
import { deriveWalkthrough, condense, type Walkthrough as WalkthroughData } from '@cadence/shared';
import { useOccurrenceDetail } from './occurrence/useOccurrenceDetail.ts';
import { isFoodRow, isWeighInPending, sheetMinutes } from './occurrence/format.ts';
import { SessionLogPanel } from './occurrence/SessionLogPanel.tsx';
import { MealLogPanel } from './occurrence/MealLogPanel.tsx';
import { WeighInPanel } from './occurrence/WeighInPanel.tsx';
import { Walkthrough } from '../walkthrough/Walkthrough.tsx';
import { setOccurrence, logOccurrence } from '../../lib/api.ts';

/**
 * The session sheet — tap an occurrence, see the coach's concrete session (blocks of items with
 * sets × reps @ load), the why (coach note), and ▶ how-to links. First open generates the
 * session server-side (one coach call, a few seconds) — same typing-dots loading as chat.
 * ▶ links are always YouTube SEARCH result pages built client-side from `video_query`; the
 * model never supplies URLs. A 404 means a re-plan replaced this day — say so plainly.
 *
 * Thin dispatcher over domain panels (WEB-03). Meal photo + weigh-in live in their own panels —
 * structural split only; behavior unchanged.
 */
export function OccurrenceSheet({
  occurrenceId,
  onClose,
  onLogged,
  onProposeChange,
}: {
  occurrenceId: string;
  onClose: () => void;
  onLogged?: () => void;
  onProposeChange?: (steer: string) => void;
}) {
  const { detail, setDetail, state } = useOccurrenceDetail(occurrenceId);
  const session = detail?.session;
  const wt = useMemo(() => (session ? deriveWalkthrough(session) : null), [session]);
  const [run, setRun] = useState<WalkthroughData | null>(null);

  async function handleComplete(summary: string) {
    if (!detail) return;
    try {
      if (summary.trim()) await logOccurrence(detail.occurrence_id, summary);
      else await setOccurrence(detail.occurrence_id, 'done');
      setDetail({ ...detail, status: 'done' });
    } catch {
      /* best-effort — the plan refresh reflects reality */
    }
    onLogged?.();
    setRun(null);
    onClose();
  }

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-label="Session detail">
        <div className="sheet-grab" aria-hidden />
        {state === 'loading' ? (
          <div className="sheet-loading">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
            <span className="sheet-loading-t">Chatting with your coach about this session…</span>
          </div>
        ) : state === 'gone' ? (
          <div className="sheet-msg">
            This session moved with your new plan — close this and take a fresh look at your week.
          </div>
        ) : state === 'error' ? (
          <div className="sheet-msg">Something hiccuped loading this session — close and tap it again.</div>
        ) : detail ? (
          <>
            <div className="sheet-head">
              <div className="sheet-title">
                <b>{detail.title}</b>
                <span>
                  {[detail.date, detail.schedule?.time_of_day, sheetMinutes(detail, wt)].filter(Boolean).join(' · ')}
                </span>
              </div>
              <button className="sheet-x" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>

            {detail.why && <div className="sheet-why">{detail.why}</div>}

            {detail.log && (
              <div className="log-chip">
                <b>Logged:</b> {detail.log.summary}
              </div>
            )}

            {session ? (
              <>
                {wt && wt.steps.length > 0 && detail.status === 'pending' && (
                  <div style={startRow}>
                    <button style={startBtn} onClick={() => setRun(wt)}>
                      ▶ Start · {wt.total_min} min
                    </button>
                    {wt.steps.length > 2 && (
                      <button style={startGhost} onClick={() => setRun(condense(wt))}>
                        Less time
                      </button>
                    )}
                  </div>
                )}
                <SessionLogPanel detail={detail} session={session} setDetail={setDetail} onLogged={onLogged} />
              </>
            ) : isFoodRow(detail) ? (
              <MealLogPanel
                detail={detail}
                setDetail={setDetail}
                onLogged={onLogged}
                onProposeChange={onProposeChange}
              />
            ) : isWeighInPending(detail) ? (
              <WeighInPanel detail={detail} setDetail={setDetail} onLogged={onLogged} />
            ) : detail.kind === 'system' ? (
              <div className="sheet-msg">A quick built-in check-in — just tap it done when it happens.</div>
            ) : detail.status !== 'pending' ? (
              <div className="sheet-msg">
                {"This one's already "}
                {detail.status === 'done' ? 'done — nice.' : `marked ${detail.status}.`}
              </div>
            ) : (
              <div className="sheet-msg">
                {"I couldn't put this session together just now — close and tap it again in a moment."}
              </div>
            )}
          </>
        ) : null}
      </div>
      {run && detail && (
        <Walkthrough
          walkthrough={run}
          title={detail.title}
          occurrenceId={detail.occurrence_id}
          onClose={() => setRun(null)}
          onComplete={handleComplete}
        />
      )}
    </>
  );
}

const startRow: CSSProperties = { display: 'flex', gap: 8, margin: '2px 0 12px' };
const startBtn: CSSProperties = {
  flex: 1,
  padding: 12,
  borderRadius: 12,
  border: 'none',
  fontWeight: 800,
  fontSize: 14,
  color: '#fff',
  background: 'var(--forest, #3f7a52)',
  cursor: 'pointer',
};
const startGhost: CSSProperties = {
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid var(--forest, #3f7a52)',
  fontWeight: 700,
  fontSize: 14,
  color: 'var(--forest, #3f7a52)',
  background: 'transparent',
  cursor: 'pointer',
};
