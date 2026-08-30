import type { HistoryPayload } from '@cadence/shared';

/**
 * `history` — the dated feed, reproducing ProgressView's existing .hist-row markup exactly
 * (sage dot for a session, dawn-3 dot + 🏁 prefix for an event) so this widget is a drop-in
 * replacement for that inline block once the page assembles from a layout (W1-6).
 */
export function HistoryWidget({ data }: { data: HistoryPayload }) {
  return (
    <div>
      {data.entries.map((h, i) => (
        <div className="hist-row" key={`${h.at}-${i}`}>
          <span className={`hist-dot${h.kind === 'event' ? ' hist-dot-event' : ''}`} />
          <div className="hist-t">
            <b>{h.kind === 'event' ? `🏁 ${h.title}` : h.title}</b>
            <span>{h.detail}</span>
          </div>
          <span className="hist-date">{h.at.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
