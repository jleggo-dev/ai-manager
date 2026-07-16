import { useEffect, useState } from 'react';
import type { SessionItem } from '@cadence/shared';
import { getOccurrenceDetail, logOccurrence, recordWeighIn, type OccurrenceDetail } from '../../lib/api.ts';
import { Orb } from '../../components/Orb.tsx';
import { MicButton } from '../../components/MicButton.tsx';

/**
 * The session sheet — tap an occurrence, see the coach's concrete session (blocks of items with
 * sets × reps @ load), the why (coach note), and ▶ how-to links. First open generates the
 * session server-side (one coach call, a few seconds) — same typing-dots loading as chat.
 * ▶ links are always YouTube SEARCH result pages built client-side from `video_query`; the
 * model never supplies URLs. A 404 means a re-plan replaced this day — say so plainly.
 */

/** "3×8 @ 55 lb · 12 min · 5 km" — compose only from the fields the item actually has. */
function qty(i: SessionItem): string {
  const parts: string[] = [];
  if (i.sets && i.reps) parts.push(`${i.sets}×${i.reps}`);
  else if (i.sets) parts.push(`${i.sets} sets`);
  else if (i.reps) parts.push(`${i.reps} reps`);
  if (i.load) parts.push(`@ ${i.load}`);
  if (i.duration_min) parts.push(`${i.duration_min} min`);
  if (i.distance_km) parts.push(`${i.distance_km} km`);
  return parts.join(' · ');
}

const ytSearch = (q: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q.replace(/\s+/g, ' ').trim())}`;

export function OccurrenceSheet({
  occurrenceId,
  onClose,
  onLogged,
}: {
  occurrenceId: string;
  onClose: () => void;
  onLogged?: () => void; // parent refreshes the week so the row shows done
}) {
  const [detail, setDetail] = useState<OccurrenceDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'error'>('loading');
  const [logText, setLogText] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [logErr, setLogErr] = useState('');
  const [weight, setWeight] = useState('');
  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>('lb');

  async function submitWeighIn() {
    const w = parseFloat(weight);
    if (!Number.isFinite(w) || w <= 0 || logBusy || !detail) return;
    setLogBusy(true);
    setLogErr('');
    try {
      await recordWeighIn(detail.occurrence_id, w, weightUnit);
      const shown = `${w} ${weightUnit}`;
      setDetail({ ...detail, status: 'done', log: { items: [], summary: `Weighed in at ${shown}.`, raw_text: shown, logged_at: new Date().toISOString() } });
      onLogged?.();
    } catch {
      setLogErr("That didn't save — check the number and try again.");
    } finally {
      setLogBusy(false);
    }
  }

  async function submitLog() {
    const text = logText.trim();
    if (!text || logBusy || !detail) return;
    setLogBusy(true);
    setLogErr('');
    try {
      const r = await logOccurrence(detail.occurrence_id, text);
      setDetail({ ...detail, status: 'done', log: r.log });
      setLogText('');
      onLogged?.();
    } catch (e) {
      const status = (e as { status?: number }).status;
      setLogErr(
        status === 404
          ? 'This session moved with your new plan — close and take a fresh look.'
          : "That didn't save — give it another try.",
      );
    } finally {
      setLogBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    getOccurrenceDetail(occurrenceId)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setState('ready');
      })
      .catch((e: Error & { status?: number }) => {
        if (!alive) return;
        setState(e.status === 404 ? 'gone' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [occurrenceId]);

  const session = detail?.session;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-label="Session detail">
        <div className="sheet-grab" aria-hidden />
        {state === 'loading' ? (
          <div className="sheet-loading">
            <span className="typing"><i /><i /><i /></span>
            <span className="sheet-loading-t">Putting your session together…</span>
          </div>
        ) : state === 'gone' ? (
          <div className="sheet-msg">This session moved with your new plan — close this and take a fresh look at your week.</div>
        ) : state === 'error' ? (
          <div className="sheet-msg">Something hiccuped loading this session — close and tap it again.</div>
        ) : detail ? (
          <>
            <div className="sheet-head">
              <div className="sheet-title">
                <b>{detail.title}</b>
                <span>
                  {[detail.date, detail.schedule?.time_of_day, detail.schedule?.duration_min ? `${detail.schedule.duration_min} min` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button className="sheet-x" onClick={onClose} aria-label="Close">×</button>
            </div>

            {/* Why this session exists — the commitment's stored rationale (persisted at commit). */}
            {detail.why && <div className="sheet-why">{detail.why}</div>}

            {detail.log && (
              <div className="log-chip">
                <b>Logged:</b> {detail.log.summary}
              </div>
            )}

            {session ? (
              <div className="sheet-body">
                {session.blocks.map((b, bi) => (
                  <div className="sess-block" key={bi}>
                    <div className="sess-label">{b.label}</div>
                    {b.items.map((it, ii) => (
                      <div className="sess-item" key={ii}>
                        <div className="sess-item-t">
                          <span className="sess-name">{it.name}</span>
                          {qty(it) && <span className="sess-qty">{qty(it)}</span>}
                        </div>
                        {it.detail && <div className="sess-detail">{it.detail}</div>}
                        {it.video_query && (
                          <a className="vid-link" href={ytSearch(it.video_query)} target="_blank" rel="noopener noreferrer">
                            ▶ how-to: {it.video_query}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                {session.note && (
                  <div className="sess-note">
                    <Orb />
                    <span>{session.note}</span>
                  </div>
                )}

                {detail.status === 'pending' && (
                  <div className="logbox">
                    <div className="logbox-label">How did it go? Tell me in your own words.</div>
                    <div className="steer-row">
                      <textarea
                        className="logbox-in"
                        value={logText}
                        onChange={(e) => setLogText(e.target.value)}
                        placeholder="e.g. did the presses — 15 reps at 50 lb, felt easy; skipped the rows"
                        rows={2}
                        disabled={logBusy}
                      />
                      <MicButton value={logText} onChange={setLogText} disabled={logBusy} />
                    </div>
                    {logErr && <div className="auth-error">{logErr}</div>}
                    <button className="logbox-btn" onClick={submitLog} disabled={logBusy || !logText.trim()}>
                      {logBusy ? 'Noting it down…' : 'Log it — done ✓'}
                    </button>
                  </div>
                )}
              </div>
            ) : detail.kind === 'system' && /weigh/i.test(detail.title) && detail.status === 'pending' ? (
              <div className="logbox" style={{ borderTop: 'none', paddingTop: 0 }}>
                <div className="logbox-label">What's the scale saying today?</div>
                <div className="weigh-row">
                  <input
                    className="wiz-in"
                    type="number"
                    inputMode="decimal"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder={weightUnit === 'lb' ? 'e.g. 195' : 'e.g. 88.5'}
                    disabled={logBusy}
                  />
                  <button className="wiz-sel" onClick={() => setWeightUnit(weightUnit === 'lb' ? 'kg' : 'lb')} disabled={logBusy}>
                    {weightUnit} ⇄
                  </button>
                </div>
                {logErr && <div className="auth-error">{logErr}</div>}
                <button className="logbox-btn" onClick={submitWeighIn} disabled={logBusy || !weight.trim()}>
                  {logBusy ? 'Noting it down…' : 'Log it — done ✓'}
                </button>
              </div>
            ) : detail.kind === 'system' ? (
              <div className="sheet-msg">A quick built-in check-in — just tap it done when it happens.</div>
            ) : detail.status !== 'pending' ? (
              <div className="sheet-msg">This one's already {detail.status === 'done' ? 'done — nice.' : `marked ${detail.status}.`}</div>
            ) : (
              <div className="sheet-msg">I couldn't put this session together just now — close and tap it again in a moment.</div>
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
