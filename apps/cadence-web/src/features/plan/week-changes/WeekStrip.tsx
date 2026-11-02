import type { WeekDay } from '../../../lib/api.ts';
import { dayChanges, dayLetter } from './weekDays.ts';

/**
 * The quiet way into the week (owner, 2026-11-01: "a more subtle indicator… keep the text light").
 * Seven day letters, a dot per session, the day the change lands on accented — so it tells you
 * where the change falls before you open anything — and one light "Week view" caption. The whole
 * strip is the button.
 */
export function WeekStrip({ week, onOpen }: { week: WeekDay[]; onOpen: () => void }) {
  if (!week.length) return null;
  return (
    <button type="button" className="wks" onClick={onOpen} aria-label="Week view">
      <span className="wks-days" aria-hidden>
        {week.map((d, i) => (
          <span key={d.date} className={`wks-day${dayChanges(d) ? ' on' : ''}${i === 0 ? ' today' : ''}`}>
            <span className="wks-letter">{dayLetter(d.date)}</span>
            <span className="wks-dots">
              {d.entries.slice(0, 4).map((e, j) => (
                <span key={j} className={`wks-dot ${e.kind}`} />
              ))}
            </span>
          </span>
        ))}
      </span>
      <span className="wks-cap" aria-hidden>
        Week view <span className="wks-chev">⌃</span>
      </span>
    </button>
  );
}
