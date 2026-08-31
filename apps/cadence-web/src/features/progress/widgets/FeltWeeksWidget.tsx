import type { FeltWeekPayload } from '@cadence/shared';

/**
 * Mood 1–5 → the design's indigo ramp: deeper means the week felt steadier
 * (oklch 88%→58% lightness, 0.03→0.08 chroma, hue 262). Color carries the whole reading, so the
 * mapping lives here in one place.
 */
function weekColor(value: number): string {
  const t = Math.min(1, Math.max(0, (value - 1) / 4));
  const l = 88 - 30 * t;
  const c = 0.03 + 0.05 * t;
  return `oklch(${l.toFixed(1)}% ${c.toFixed(3)} 262)`;
}

/**
 * `felt_week` — four side-by-side week bars colored by that week's average daily note (owner
 * design 1a, "Calmer evenings" card). A week with no noted day stays a hairline outline — unread,
 * never a filled "zero". The footer states only what the payload computed: how many daily notes
 * the coloring rests on.
 */
export function FeltWeeksWidget({ data }: { data: FeltWeekPayload }) {
  const totalDays = data.weeks.reduce((sum, w) => sum + w.days, 0);
  const anyUnread = data.weeks.some((w) => w.value === null);
  const lastIdx = data.weeks.length - 1;
  return (
    <div>
      <div className="pw-felt">
        {data.weeks.map((week, i) => (
          <div className="pw-felt-week" key={`${week.label}-${i}`}>
            {week.value === null ? (
              <div className="pw-felt-bar pw-felt-bar--unread" />
            ) : (
              <div className="pw-felt-bar" style={{ background: weekColor(week.value) }} />
            )}
            <div className={i === lastIdx ? 'pw-felt-label pw-felt-label--latest' : 'pw-felt-label'}>{week.label}</div>
          </div>
        ))}
      </div>
      <div className="pw-footer">
        Deeper means the week felt steadier — from {totalDays} daily {totalDays === 1 ? 'note' : 'notes'}.
        {anyUnread ? " An outlined week just wasn't noted." : ''}
      </div>
    </div>
  );
}
