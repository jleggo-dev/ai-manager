import { useEffect, useState, type ReactNode } from 'react';
import { getTrace, getCoachLog, type DevTrace, type AiLogEntry } from '../../lib/api.ts';

/** Pretty-print any value for a code block. */
function json(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function Card({
  title,
  tone,
  open,
  onToggle,
  children,
}: {
  title: string;
  tone: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="devcard">
      <button className="devcard-h" data-tone={tone} onClick={onToggle} aria-expanded={open}>
        <span className="devcard-left">
          <span className="devdot" />
          {title}
        </span>
        <span className="devchev">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="devcard-b">{children}</div>}
    </div>
  );
}

type Section = 'ctx' | 'prompts' | 'coach' | 'broker' | 'history';

const Label = ({ children }: { children: ReactNode }) => <div className="devlabel">{children}</div>;
// `dump` boxes long reference blobs (persona, raw JSON, capture, log rows) in their own capped,
// scrollable box so they don't blow out the single panel scroll; narrative text flows uncapped.
const Pre = ({ children, dump }: { children: ReactNode; dump?: boolean }) => (
  <pre className={dump ? 'devpre dump' : 'devpre'}>{children}</pre>
);

/**
 * Developer "X-ray" panel — polls GET /coach/trace and shows the behind-the-scenes AI
 * activity next to the phone. Collapsible accordion sections, each independently scrollable.
 */
export function DevPanel() {
  const [t, setT] = useState<DevTrace | null>(null);
  const [log, setLog] = useState<AiLogEntry[]>([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Record<Section, boolean>>({ ctx: true, prompts: true, coach: true, broker: true, history: false });
  const toggle = (k: Section) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  useEffect(() => {
    let alive = true;
    const tick = () => {
      getTrace()
        .then((d) => alive && (setT(d), setErr('')))
        .catch((e) => alive && setErr(String(e)));
      getCoachLog()
        .then((l) => alive && setLog(l.entries))
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const ctx = t?.context ?? null;
  const empty = !t || t.empty || (!ctx && !t.coach);

  return (
    <div className="devpanel">
      <h3>
        <span>🛠 X-ray</span>
        <span className="muted">
          {t?.context?.mode && <span className="dev-badge">{t.context.mode}</span>}{' '}
          {t?.updatedAt ? new Date(t.updatedAt).toLocaleTimeString() : ''}
        </span>
      </h3>

      {err && <div className="devcard-b" style={{ color: 'var(--danger)' }}>{err}</div>}
      {empty && !err && (
        <div className="devnote">No activity yet — send a message in the phone and this fills in.</div>
      )}

      <Card title="1 · Context data (pulled)" tone="green" open={open.ctx} onToggle={() => toggle('ctx')}>
        {ctx ? (
          <>
            <Label>selection · {ctx.mode}</Label>
            <div style={{ marginBottom: 6 }}>{ctx.selectReason}</div>
            <Label>functions run (provenance)</Label>
            <Pre>{ctx.provenance.map((p) => `${p.fn}(${p.rows})`).join('  ·  ') || '—'}</Pre>
            <Label>raw data</Label>
            <Pre dump>{json(ctx.data)}</Pre>
          </>
        ) : (
          <span className="muted">built at session open (first message)</span>
        )}
      </Card>

      <Card title="2 · Prompts sent" tone="iris" open={open.prompts} onToggle={() => toggle('prompts')}>
        <Label>system · persona (from the coach job)</Label>
        <Pre dump>{t?.persona ?? '—'}</Pre>
        <Label>context turn (injected pack)</Label>
        <Pre>{ctx?.rendered ?? '—'}</Pre>
        <Label>user message (sent to the LLM)</Label>
        <Pre>{t?.coach?.user ?? '—'}</Pre>
      </Card>

      <Card title="3 · Coach response" tone="ember" open={open.coach} onToggle={() => toggle('coach')}>
        {t?.coach ? (
          <>
            <Pre>{t.coach.reply || '—'}</Pre>
            <Label>
              model: {t.coach.model ?? '—'} · tokens: {t.coach.promptTokens ?? '—'}/{t.coach.completionTokens ?? '—'}
            </Label>
          </>
        ) : (
          <span className="muted">send a message</span>
        )}
      </Card>

      <Card title="4 · Broker responses" tone="iris" open={open.broker} onToggle={() => toggle('broker')}>
        <Label>pack-select (chose functions)</Label>
        <Pre>{t?.brokerSelect ? json(t.brokerSelect) : '— (deterministic fallback)'}</Pre>
        <Label>pack-summarize (rendered block)</Label>
        <Pre>{t?.brokerSummarize?.output ?? '— (deterministic fallback)'}</Pre>
        <Label>context-select (per-turn just-in-time fns)</Label>
        <Pre>
          {t?.turnSelect
            ? [
                `chose: ${t.turnSelect.calls.map((c) => c.fn).join(', ') || 'none'}`,
                `ran:   ${t.turnSelect.provenance.map((p) => `${p.fn}(${p.rows})`).join('  ·  ') || '—'}`,
                `injected: ${t.turnSelect.injected ? 'yes' : 'no'}${t.turnSelect.fallback ? ' (select failed)' : ''}`,
                `why: ${t.turnSelect.reason || '—'}`,
              ].join('\n')
            : '— (no turn assessed yet)'}
        </Pre>
        <Label>capture_extract (goals / equipment / baseline)</Label>
        <Pre dump>{t?.capture ? json(t.capture) : '—'}</Pre>
      </Card>

      <Card title="5 · History (durable log)" tone="green" open={open.history} onToggle={() => toggle('history')}>
        {log.length === 0 && <span className="muted">no log entries yet</span>}
        {log.map((e, i) => (
          <div className="devlog" key={i}>
            <div className="devlog-h">
              {e.kind} · {new Date(e.created_at).toLocaleTimeString()}
            </div>
            {e.kind === 'coach' ? (
              <>
                <div className="devlog-line"><b>you</b> {String((e.input as { user?: string })?.user ?? '')}</div>
                <div className="devlog-line"><b>coach</b> {String((e.output as { reply?: string })?.reply ?? '')}</div>
              </>
            ) : (
              <Pre dump>{json(e.output ?? e.input)}</Pre>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
