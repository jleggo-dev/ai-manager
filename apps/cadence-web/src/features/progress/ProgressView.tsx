import { useEffect, useState } from 'react';
import type { ProgressCard, ProgressTrend } from '@cadence/shared';
import { getProgress, addGoalEvent } from '../../lib/api.ts';
import { Sparkline, CountBar } from '../../components/viz.tsx';

/**
 * The Progress tab — "variable, coach-shaped" content that derives entirely from the user's
 * own goals and logged data (a no-fitness user simply has no fitness cards). Cards per goal,
 * trend sparklines per activity with ≥2 honest points, and a History feed. All numbers are
 * computed server-side (services/progress.ts); no LLM anywhere in this surface. The inline-SVG
 * sparkline/bar primitives are shared with the Today dashboard (components/viz.tsx).
 */

export function ProgressView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getProgress>> | null>(null);
  const [err, setErr] = useState(false);
  const [addFor, setAddFor] = useState<string | null>(null); // goal_id with the add-input open
  const [addLabel, setAddLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    getProgress()
      .then(setData)
      .catch(() => setErr(true));
  useEffect(() => {
    load();
  }, []);

  async function submitAdd(goalId: string) {
    const label = addLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      await addGoalEvent(goalId, label);
      setAddFor(null);
      setAddLabel('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <div className="scrollbody">
        <div className="wiz-empty" style={{ marginTop: 24 }}>
          Couldn't load your progress just now — hop to another tab and back.
        </div>
      </div>
    );
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

  const empty = data.cards.length === 0 && data.trends.length === 0 && data.history.length === 0;

  const Card = ({ c }: { c: ProgressCard }) => {
    if (c.kind === 'latest_vs_target') {
      const dir =
        c.start !== null && c.latest !== null ? (c.latest < c.start ? '↓' : c.latest > c.start ? '↑' : '→') : '';
      return (
        <div className="prog-card">
          <div className="prog-title">{c.title}</div>
          <div className="prog-big">
            {c.latest ?? '—'} <span className="prog-unit">{c.unit}</span>{' '}
            {dir && <span className="prog-dir">{dir}</span>}
          </div>
          <div className="prog-sub">
            {c.start !== null ? `started ${c.start}` : 'no starting point yet'} · target {c.target}
          </div>
          {c.series.length >= 2 && <Sparkline series={c.series} good="down" />}
        </div>
      );
    }
    if (c.kind === 'count') {
      return (
        <div className="prog-card">
          <div className="prog-title">{c.title}</div>
          <div className="prog-big">
            {c.current}
            <span className="prog-unit">
              /{c.target} {c.unit}
            </span>
          </div>
          <CountBar current={c.current} target={c.target} />
          {addFor === c.goal_id ? (
            <div className="prog-add">
              <input
                className="wiz-in"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitAdd(c.goal_id)}
                placeholder="What did you finish? e.g. Dune"
                disabled={busy}
                autoFocus
              />
              <button className="logbox-btn" onClick={() => submitAdd(c.goal_id)} disabled={busy || !addLabel.trim()}>
                Add
              </button>
            </div>
          ) : (
            <button
              className="prog-addbtn"
              onClick={() => {
                setAddFor(c.goal_id);
                setAddLabel('');
              }}
            >
              + add one
            </button>
          )}
        </div>
      );
    }
    if (c.kind === 'countdown') {
      return (
        <div className="prog-card">
          <div className="prog-title">{c.title}</div>
          <div className="prog-big">
            {c.days_left}
            <span className="prog-unit"> days out</span>
          </div>
          <div className="prog-sub">
            {c.milestones_total > 0 ? `stepping-stones ${c.milestones_done}/${c.milestones_total} · ` : ''}
            {c.end}
          </div>
        </div>
      );
    }
    return (
      <div className="prog-card">
        <div className="prog-title">{c.title}</div>
        <div className="prog-big">
          {c.kept}
          <span className="prog-unit"> of {c.window} days</span>
        </div>
        <div className="prog-sub">this week — a missed day is information, not failure</div>
      </div>
    );
  };

  return (
    <div className="scrollbody">
      {empty ? (
        <>
          <div className="screen-title" style={{ marginTop: 10 }}>
            Progress
          </div>
          <div className="screen-sub">
            Keep logging sessions and weigh-ins — your trends and wins will show up here as real data accumulates.
          </div>
        </>
      ) : (
        <>
          {data.cards.map((c, i) => (
            <Card key={i} c={c} />
          ))}

          {data.trends.length > 0 && (
            <div className="plan-week-label" style={{ marginTop: 16 }}>
              Trends
            </div>
          )}
          {data.trends.map((t: ProgressTrend, i) => (
            <div className="prog-card" key={`t${i}`}>
              <div className="prog-title">{t.title}</div>
              <div className="prog-trend-row">
                <div>
                  <div className="prog-big">
                    {t.series[t.series.length - 1]!.value}
                    <span className="prog-unit"> {t.unit}</span>
                  </div>
                  <div className="prog-sub">
                    {t.label.toLowerCase()} · was {t.series[0]!.value} {t.unit}
                  </div>
                </div>
                <Sparkline series={t.series} good={t.direction_good} />
              </div>
            </div>
          ))}

          {data.history.length > 0 && (
            <div className="plan-week-label" style={{ marginTop: 16 }}>
              History
            </div>
          )}
          {data.history.map((h, i) => (
            <div className="hist-row" key={`h${i}`}>
              <span className={`hist-dot${h.kind === 'event' ? ' hist-dot-event' : ''}`} />
              <div className="hist-t">
                <b>{h.kind === 'event' ? `🏁 ${h.title}` : h.title}</b>
                <span>{h.detail}</span>
              </div>
              <span className="hist-date">{h.at.slice(5)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
