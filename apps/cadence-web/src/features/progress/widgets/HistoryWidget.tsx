import type { HistoryPayload } from '@cadence/shared';

/**
 * `history` — the log, demoted per the owner design (1a "this week" list): WidgetSection gives it
 * a hairline section label instead of a goal-card header, and each row is a small dot (sage for a
 * session, dawn-3 for an event — .hist-dot from styles.css), the title with its detail inline
 * after an em dash, and the date at the right.
 */
export function HistoryWidget({ data }: { data: HistoryPayload }) {
  return (
    <div>
      {data.entries.map((h, i) => (
        <div className="hist-row" key={`${h.at}-${i}`}>
          <span className={`hist-dot${h.kind === 'event' ? ' hist-dot-event' : ''}`} />
          <div className="pw-log-t">
            <b>{h.title}</b>
            {h.detail && <span> — {h.detail}</span>}
          </div>
          <span className="hist-date">{h.at.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}
