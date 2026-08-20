import { useState } from 'react';
import type { Meal, MealMacros } from '../../lib/api.ts';
import { CeilingBar, FloorBar, MiniFloorBar, readingLabel, readingText } from './NutrientBar.tsx';
import { buildNutrientsView, countedLine, type NutrientReading } from './nutrients.ts';

/**
 * Nutrients (Food Journey 09/5C) — a drill-down off the macro block, not a tab of its own.
 *
 * The eight micronutrients have flowed end to end since 2026-08-15 — logged, summed onto the day,
 * shipped in `totals` — and nothing has ever drawn them. This is that screen: what to reach for,
 * the one thing to stay under, and everything else quietly counted.
 *
 * It refuses to invent a shortfall. If nothing logged carried mineral data the lists are replaced
 * by a sentence saying exactly that, because eight bars reading zero would tell someone who ate
 * perfectly well that they failed at everything.
 */

const ASK_NOTE =
  'They opened Nutrients from their Food screen and tapped through to you. These are the eight ' +
  'micronutrients the app can actually count — iron, zinc, calcium, potassium, vitamin C, B12, ' +
  'fibre, and sodium, which is the only one to stay under. Read what is on file before asking them ' +
  'to repeat it (get_nutrition). Their totals only count food we hold real data for, so they are a ' +
  'floor rather than a measurement — never tell someone they are deficient, and say plainly when ' +
  'the honest answer is "we cannot see enough yet". Food first if they ask what to do about it; ' +
  'supplements and anything medical stay with professionals.';

function Reading({ r, withWhy }: { r: NutrientReading; withWhy?: boolean }) {
  const t = readingText(r);
  return (
    <div className="nu-row">
      <div className="nu-row-h">
        <span className="nu-row-n">{r.label}</span>
        <span className="nu-row-v" aria-label={readingLabel(r)}>
          {t.value} <span>{t.rest}</span>
        </span>
      </div>
      <FloorBar r={r} />
      {withWhy && <span className="nu-why">{r.why}</span>}
    </div>
  );
}

function Ceiling({ r }: { r: NutrientReading }) {
  const t = readingText(r);
  return (
    <div className="nu-card nu-ceil-card">
      <div className="nu-row-h">
        <span className="nu-row-n">
          {r.label}
          <i className="nu-under">STAY UNDER</i>
        </span>
        <span className="nu-row-v" aria-label={readingLabel(r)}>
          {t.value} <span>{t.rest}</span>
        </span>
      </div>
      <CeilingBar r={r} />
      <span className="nu-why">
        {r.over ? 'A budget, not a goal — today went past it. ' : 'A budget, not a goal. '}
        {r.why}
      </span>
    </div>
  );
}

export function NutrientsPanel({
  dateLabel,
  dayTotals,
  dayMeals,
  week,
  onBack,
  onCoach,
}: {
  dateLabel: string;
  dayTotals: MealMacros;
  dayMeals: Meal[];
  /** The week's per-day AVERAGE (a daily reference intake only means anything against a day) plus
   *  the meals behind it. Null while recent meals are still in flight. */
  week: { avg: MealMacros | null; meals: Meal[]; days: number } | null;
  onBack: () => void;
  onCoach: (note: string) => void;
}) {
  const [scope, setScope] = useState<'day' | 'week'>('day');
  const weekly = scope === 'week';
  const view = buildNutrientsView(weekly ? (week?.avg ?? {}) : dayTotals, weekly ? (week?.meals ?? []) : dayMeals);

  return (
    <div className="nu" role="region" aria-label="Nutrients">
      <div className="fh-head">
        <button className="fh-back" onClick={onBack} aria-label="Back to your food">
          ‹
        </button>
        <b className="fh-title">Nutrients</b>
        <span className="fh-daypill">{weekly ? 'This week' : dateLabel}</span>
      </div>

      <div className="fh-seg" role="tablist" aria-label="Nutrients range">
        <button role="tab" aria-selected={!weekly} className={weekly ? '' : 'is-on'} onClick={() => setScope('day')}>
          This day
        </button>
        <button role="tab" aria-selected={weekly} className={weekly ? 'is-on' : ''} onClick={() => setScope('week')}>
          This week
        </button>
      </div>

      <div className="nu-body">
        {weekly && week && week.days === 0 ? (
          <p className="nu-empty">
            {'Nothing has finished yet this week, so there is no daily average to read. Come back once a '}
            {'day is behind you.'}
          </p>
        ) : view.unmeasured ? (
          <p className="nu-empty">
            {'Nothing here can be counted yet — minerals arrive with foods we hold real data for. '}
            {countedLine(view)}
          </p>
        ) : (
          <>
            {view.aiming.length > 0 && (
              <>
                <div className="nu-sec">AIMING TO REACH THESE</div>
                <div className="nu-card">
                  {view.aiming.map((r, i) => (
                    <Reading key={r.key} r={r} withWhy={i === 0} />
                  ))}
                </div>
              </>
            )}

            {view.ceiling && (
              <>
                <div className="nu-sec">STAYING UNDER THIS ONE</div>
                <Ceiling r={view.ceiling} />
              </>
            )}

            <div className="nu-sec">ALSO COUNTED</div>
            <div className="nu-card nu-list">
              {view.also.map((r) => {
                const t = readingText(r);
                return (
                  <div className="nu-lrow" key={r.key}>
                    <span className="nu-lrow-n">{r.label}</span>
                    <MiniFloorBar r={r} />
                    <span className="nu-lrow-v" aria-label={readingLabel(r)}>
                      {t.value} {t.rest}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="nu-note">{countedLine(view)}</p>
          </>
        )}
      </div>

      <button className="nu-ask" onClick={() => onCoach(ASK_NOTE)}>
        <span className="nu-ask-face" aria-hidden />
        <span>Ask about any of these</span>
        <i aria-hidden>›</i>
      </button>
    </div>
  );
}
