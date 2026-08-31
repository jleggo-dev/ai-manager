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

/**
 * `repertoire` — the piece list (owner design 1a, piano card): learned rows get a filled plum
 * check circle and their month; the one being worked gets a hollow plum ring and its week count;
 * a coach-proposed item they haven't touched gets a dashed grey circle. Measured in pieces, not
 * minutes — the footer says so from the payload's own noun, and names how far the working item is.
 */
export function RepertoireWidget({ data }: { data: RepertoirePayload }) {
  const working = data.items
    .filter((i) => i.state === 'in_progress')
    .reduce<RepertoireCardItem | null>((best, i) => ((i.weeks_in ?? 1) > (best?.weeks_in ?? 0) ? i : best), null);
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
      <div className="pw-footer">
        Measured in {data.noun} learned, not minutes practiced.
        {working ? ` ${working.label} is in week ${working.weeks_in ?? 1}.` : ''}
      </div>
    </div>
  );
}
