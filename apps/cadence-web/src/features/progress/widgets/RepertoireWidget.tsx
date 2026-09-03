import type { RepertoireCardItem, RepertoirePayload } from '@cadence/shared';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' → 'Mar'. A backfilled learned item has no month and shows none. */
function monthLabel(learnedMonth: string | null | undefined): string {
  const m = learnedMonth ? Number(learnedMonth.slice(5, 7)) : NaN;
  return MONTH_ABBR[m - 1] ?? '';
}

/** The right-hand standing line for one row. Plain states: learned (with its month when we saw
 *  it happen), in progress with the week count, or the coach's pick they haven't started. */
function standing(item: RepertoireCardItem): { text: string; inProgress: boolean } {
  if (item.state === 'learned') {
    const month = monthLabel(item.learned_month);
    return { text: month ? `learned · ${month}` : 'learned', inProgress: false };
  }
  if (item.state === 'in_progress') {
    return { text: `in progress · week ${item.weeks_in ?? 1}`, inProgress: true };
  }
  return { text: "coach's pick · not started", inProgress: false };
}

/** A bar's height in px — proportional to the tallest of the three years shown, with no target
 *  and no fixed denominator (design frame 2c: "no target" means only a relative comparison
 *  between the three years). Never fully flat: a year with nothing learned still draws a visible
 *  nub, so "zero" reads as a fact on the chart rather than a missing bar. */
const BAR_MAX_PX = 48;
const BAR_MIN_PX = 6;
function barHeightPx(count: number, maxCount: number): number {
  if (maxCount <= 0) return BAR_MIN_PX;
  return Math.max(BAR_MIN_PX, Math.round((count / maxCount) * BAR_MAX_PX));
}

/**
 * `repertoire` — the piece list (owner design 1a, piano card): learned rows get a filled plum
 * check circle and their month; the one being worked gets a hollow plum ring and its week count;
 * a coach-proposed item they haven't touched gets a dashed grey circle. Measured in pieces, not
 * minutes — the footer says so from the payload's own noun, and names how far the working item is.
 *
 * Design frame 2c (owner 2026-09-02) adds the by-year section below the piece list: this year's
 * learned pieces in the order the resolver already sorted them ("Écossaise · 5 wks" — never
 * re-sorted here), then three plain bars comparing the trailing three years. Both sections read
 * straight off the payload the resolver already computed (retired counts, backfill excluded,
 * weeks never below 1) — the widget does no counting of its own.
 */
export function RepertoireWidget({ data }: { data: RepertoirePayload }) {
  const working = data.items
    .filter((i) => i.state === 'in_progress')
    .reduce<RepertoireCardItem | null>((best, i) => ((i.weeks_in ?? 1) > (best?.weeks_in ?? 0) ? i : best), null);
  const maxYearCount = Math.max(0, ...data.years.map((y) => y.count));
  return (
    <div>
      <div className="pw-rep">
        {data.items.map((item, i) => {
          const line = standing(item);
          return (
            <div className="pw-rep-row" key={`${item.label}-${i}`}>
              <span className={`pw-rep-mark pw-rep-mark--${item.state}`} aria-hidden>
                {item.state === 'learned' ? '✓' : ''}
              </span>
              <span className={`pw-rep-label${item.state === 'not_started' ? ' pw-rep-label--quiet' : ''}`}>
                {item.label}
              </span>
              <span className={line.inProgress ? 'pw-rep-standing pw-rep-standing--working' : 'pw-rep-standing'}>
                {line.text}
              </span>
            </div>
          );
        })}
      </div>
      {data.learned_by_month.length > 0 && (
        <div className="pw-rep-year">
          {data.learned_by_month.map((m, i) => (
            <div className="pw-rep-year-row" key={`${m.month}-${m.label}-${i}`}>
              <span className="pw-rep-year-label">{m.label}</span>
              <span className="pw-rep-year-weeks"> · {m.weeks} wks</span>
            </div>
          ))}
        </div>
      )}
      {data.years.length > 0 && (
        <div className="pw-rep-bars" aria-label="learned by year">
          {data.years.map((y) => (
            <div className="pw-rep-bar-col" key={y.year}>
              <div className="pw-rep-bar-track">
                <div className="pw-rep-bar-fill" style={{ height: `${barHeightPx(y.count, maxYearCount)}px` }} />
              </div>
              <span className="pw-rep-bar-count">{y.count}</span>
              <span className="pw-rep-bar-label">’{String(y.year).slice(2)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="pw-footer">
        Measured in {data.noun} learned, not minutes practiced.
        {working ? ` ${working.label} is in week ${working.weeks_in ?? 1}.` : ''}
      </div>
    </div>
  );
}
