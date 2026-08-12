import type { PlanActivity, PlanDay } from '../../lib/api.ts';

/**
 * The 7-day strip at the top of the plan card: one column per day, up to three dots coloured by
 * the AREA of the goal each occurrence serves (movement/nourishment/mind/practice — the same
 * palette as the quick-pick dots), "off" on empty days. Replaces the old WeekTease, which
 * coloured by user/system kind — a distinction nobody outside the codebase can read.
 */
export function WeekStrip({ week, activities }: { week: PlanDay[]; activities: PlanActivity[] }) {
  if (!week.length) return null;
  const byId = new Map(activities.map((a) => [a.activity_id, a]));
  return (
    <div className="gate-week" aria-hidden>
      {week.slice(0, 7).map((d) => (
        <div key={d.date} className="gate-day">
          <span className="gate-dl">{d.weekday.slice(0, 1)}</span>
          <span className="gate-dbox">
            {d.occurrences.length ? (
              d.occurrences.slice(0, 3).map((o) => {
                const a = byId.get(o.activity_id);
                return <i key={o.occurrence_id} className={`gate-dot${a?.area ? ` is-${a.area}` : ' is-none'}`} />;
              })
            ) : (
              <em>off</em>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
