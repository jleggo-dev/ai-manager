import type { WeekDay, WeekEntry } from '../../../lib/api.ts';
import { dayChanges, dayLabel } from './weekView.ts';

/**
 * The sheet's full height: the seven days with the change applied, grouped by day (owner ask,
 * 2026-11-01). The changed sessions carry the accent; everything else is dimmed but present,
 * because the reason to look at the week is to see what the change sits next to. A session that
 * moves is struck through on the day it leaves and marked new on the day it arrives.
 */
const TAG: Partial<Record<WeekEntry['kind'], string>> = { changed: 'Changed', new: 'New' };

function Entry({ e }: { e: WeekEntry }) {
  return (
    <li className={`wkv-row ${e.kind}`}>
      <span className="wkv-time">{e.time ?? ''}</span>
      <span className="wkv-title">
        {e.title}
        {e.was_time != null && <span className="wkv-was"> · was {e.was_time}</span>}
      </span>
      {TAG[e.kind] ? <span className="wkv-tag">{TAG[e.kind]}</span> : e.minutes ? <span className="wkv-min">{e.minutes} min</span> : null}
    </li>
  );
}

export function WeekView({ week }: { week: WeekDay[] }) {
  return (
    <div className="wkv">
      {week.map((d, i) => (
        <section key={d.date} className={`wkv-day${dayChanges(d) ? ' on' : ''}`} aria-label={dayLabel(d.date, i)}>
          <h3 className="wkv-head">{dayLabel(d.date, i)}</h3>
          {d.entries.length ? (
            <ul className="wkv-list">
              {d.entries.map((e, j) => (
                <Entry key={`${e.kind}-${e.title}-${j}`} e={e} />
              ))}
            </ul>
          ) : (
            <p className="wkv-empty">Nothing planned</p>
          )}
        </section>
      ))}
    </div>
  );
}
