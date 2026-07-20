import { useState } from 'react';
import type { OccurrenceSession } from '@cadence/shared';
import { logOccurrence, type OccurrenceDetail } from '../../../lib/api.ts';
import { Orb } from '../../../components/Orb.tsx';
import { MicButton } from '../../../components/MicButton.tsx';
import { qty, ytSearch } from './format.ts';

/**
 * Prescribed session blocks + "how did it go?" free-text log. ▶ links are always YouTube
 * SEARCH pages from `video_query` — the model never supplies URLs.
 */
export function SessionLogPanel({
  detail,
  session,
  setDetail,
  onLogged,
}: {
  detail: OccurrenceDetail;
  session: OccurrenceSession;
  setDetail: (d: OccurrenceDetail) => void;
  onLogged?: () => void;
}) {
  const [logText, setLogText] = useState('');
  const [logBusy, setLogBusy] = useState(false);
  const [logErr, setLogErr] = useState('');

  async function submitLog() {
    const text = logText.trim();
    if (!text || logBusy) return;
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

  return (
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
  );
}
