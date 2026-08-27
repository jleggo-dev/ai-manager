import { Ring } from '../../../components/viz.tsx';
import type { WeekReviewDay } from '../../../lib/api.ts';
import { dayCompletion } from './week-review-derive.ts';

/** "Tu" / "We" — two letters read at chip size without truncating oddly mid-word. */
function weekdayLabel(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
  } catch {
    return '';
  }
}
function dayNum(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso.slice(-2) : String(d.getDate());
}

/**
 * Seven day chips — one completion ring apiece (`Ring`, viz.tsx: a fraction arc over a neutral
 * track, never a red one). Tapping a chip opens WeekReviewSheet's drill-in for that date; nothing
 * here fetches or mutates, it only reports which date was picked.
 *
 * A day with nothing scheduled (`total === 0` — a rest day) draws an EMPTY ring rather than a red
 * or dashed one: there was nothing to keep, so there is nothing missed either (BRAND.md).
 */
export function DayChips({ days, onSelect }: { days: WeekReviewDay[]; onSelect: (date: string) => void }) {
  return (
    <div className="wkr-daychips" role="list" aria-label="Days this week">
      {days.map((day) => {
        const { kept, total } = dayCompletion(day);
        return (
          <button
            key={day.date}
            type="button"
            className="wkr-daychip"
            role="listitem"
            onClick={() => onSelect(day.date)}
            aria-label={`${weekdayLabel(day.date)} ${dayNum(day.date)} — ${kept} of ${total} kept`}
          >
            <Ring fraction={total > 0 ? kept / total : 0} color="var(--forest)" size={40} thickness={4}>
              <span className="wkr-daychip-n">{dayNum(day.date)}</span>
            </Ring>
            <span className="wkr-daychip-wd">{weekdayLabel(day.date)}</span>
          </button>
        );
      })}
    </div>
  );
}
