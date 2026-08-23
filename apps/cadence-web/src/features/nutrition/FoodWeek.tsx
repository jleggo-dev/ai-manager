import type { Meal, MealMacros } from '../../lib/api.ts';
import { buildWeek, type WeekDay } from './foodWeekModel.ts';
import { MacroBars } from './MacroBars.tsx';
import { NutritionRing } from './NutritionRing.tsx';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * The Week tab (Food Journey 08b) — the same surface as the day, second tab, no new navigation:
 * averages against target, then every day of it.
 *
 * The frame's rule is the whole screen: **a blank day is not a bad day.** Days nobody has lived yet
 * read "not yet"; a lived day with nothing on it reads "nothing logged". Neither reads zero, and
 * neither gets a bar — an empty track is the honest picture of an empty day.
 *
 * Averages skip today for the same reason (see `foodWeekModel.ts`): a day in progress is not a result.
 */
function DayRow({ d, scale, onOpen }: { d: WeekDay; scale: number; onOpen?: (date: string) => void }) {
  const lived = d.state === 'logged';
  const width = lived && scale > 0 ? `${Math.min(100, (d.kcal / scale) * 100)}%` : '0%';
  const label = lived
    ? `${d.dow} ${d.dayLabel} — ${fmt(d.kcal)} kcal`
    : `${d.dow} ${d.dayLabel} — ${d.state === 'future' ? 'not yet' : 'nothing logged'}`;
  return (
    <button
      className={`fw-day${d.isToday ? ' is-today' : ''}`}
      onClick={() => onOpen?.(d.date)}
      disabled={!onOpen || d.state === 'future'}
      aria-label={label}
    >
      <span className="fw-day-d">
        <b>{d.dow}</b>
        <span>{d.dayLabel}</span>
      </span>
      <span className="fw-day-bar">
        <span className="fw-day-fill" style={{ width }} />
      </span>
      <span className="fw-day-v">
        <b>{lived ? fmt(d.kcal) : '—'}</b>
        <span>{lived ? `${fmt(d.protein_g)}g protein` : d.state === 'future' ? 'not yet' : 'nothing logged'}</span>
      </span>
    </button>
  );
}

export function FoodWeek({
  today,
  meals,
  targets,
  onOpenDay,
}: {
  today: string;
  meals: Meal[];
  targets: MealMacros | null;
  onOpenDay?: (date: string) => void;
}) {
  const week = buildWeek(today, meals);
  const targetKcal = typeof targets?.kcal === 'number' && targets.kcal > 0 ? targets.kcal : null;
  const avgKcal = week.avg?.kcal ?? 0;
  // Without a target the bars still need a common scale, so the busiest day sets it.
  const scale = targetKcal ?? Math.max(...week.days.map((d) => d.kcal), 1);

  return (
    <div className="fw">
      <div className="fh-card">
        <div className="fh-card-row">
          <div className="fh-ringcol">
            <NutritionRing logged={avgKcal} target={targetKcal} size={104} stroke={11}>
              {week.avg ? (
                <>
                  <b>{fmt(avgKcal)}</b>
                  <span>KCAL AVG</span>
                </>
              ) : (
                <>
                  <b>—</b>
                  <span>NOT YET</span>
                </>
              )}
            </NutritionRing>
            <span className="fh-ring-sub">
              {week.avg
                ? `averages across the ${week.avgDays} ${week.avgDays === 1 ? 'day' : 'days'} behind you` +
                  (targetKcal ? ` · target ${fmt(targetKcal)}` : '')
                : 'today is still going — nothing to average yet'}
            </span>
          </div>
          <div className="fh-barscol">
            <MacroBars eaten={week.avg ?? {}} targets={targetKcal ? targets : null} />
          </div>
        </div>
      </div>

      <div className="fh-sec-head fw-head">
        <span>EVERY DAY</span>
        {onOpenDay && <i>Tap a day ›</i>}
      </div>
      <div className="fw-days">
        {week.days.map((d) => (
          <DayRow key={d.date} d={d} scale={scale} onOpen={onOpenDay} />
        ))}
      </div>
    </div>
  );
}
