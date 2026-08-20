import type { MealKind, NutritionDayData } from '../../lib/api.ts';
import { FoodDiary } from './FoodDiary.tsx';
import { MacroBars } from './MacroBars.tsx';
import { NutritionInsightCard } from './NutritionInsightCard.tsx';
import { NutritionRing } from './NutritionRing.tsx';
import { WaterRow } from './WaterRow.tsx';
import type { FoodHomeSub } from './foodHomeSub.ts';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** She takes the meal in words; the confirm card does the saving (nothing counts until a tap). */
function logNote(meal?: MealKind): string {
  const where = meal ? `Log on ${meal}` : 'Log a meal';
  return (
    `They tapped "${where}" on their Food home and switched to you to say what they ate. ` +
    'Open on that — take the meal in their own words, one line is enough; the confirm card does ' +
    'the saving. Keep any amount they state; ask plainly when one is missing rather than guessing.'
  );
}

const TALK_NOTE =
  'They opened "Talk food with me" from their Food home. Open on food with the doors on offer: ' +
  'anything to work around (allergies first — they change every suggestion after), calorie and ' +
  'macro targets, or how the week of eating is going. Read what is on file before asking them to ' +
  'repeat it (get_nutrition; the dietary profile is in your dossier). If they name allergies or ' +
  'foods to avoid, say plainly what you will work around and let the confirm card do the saving. ' +
  'Medical needs stay with professionals — you are not one.';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The Day tab of the Food screen (Food Journey 02 + 08) — what's left, the day's parts, water,
 * one action bar. Today first, then the doors, and the doors are EARNED.
 *
 * One chart language: a ring for calories, bars for macros — dashed while counting (no target),
 * gaining a fill and a denominator when targets arrive. Nothing is added when they do. The macro
 * block is also the way into Nutrients, per the frame: the eight micronutrients are a drill-down
 * off the read you already came here for, never a tab of their own.
 *
 * A day behind you is READ-ONLY. The writes on this screen (a meal, a glass of water) all land on
 * today by design, so rather than quietly logging Tuesday's dinner onto Friday, the past simply
 * shows what happened and says so.
 */
export function FoodDay({
  day,
  isToday,
  weekDates,
  loggedDates,
  hasWeek,
  cookbookTail,
  confirming,
  onConfirm,
  onCoach,
  onSub,
  onNutrients,
  waterMl,
  onWater,
}: {
  day: NutritionDayData | null;
  isToday: boolean;
  weekDates: string[];
  loggedDates: Set<string>;
  hasWeek: boolean;
  cookbookTail: string;
  confirming: string | null;
  onConfirm: (logId: string) => void;
  onCoach: (note: string) => void;
  onSub: (sub: FoodHomeSub) => void;
  onNutrients: () => void;
  waterMl: number | null;
  onWater: (ml: number) => void;
}) {
  const targetKcal = day?.targets?.kcal ?? null;
  const scored = typeof targetKcal === 'number' && targetKcal > 0;
  const eaten = day?.totals.kcal ?? 0;
  const left = scored ? Math.max(0, Math.round(day?.left?.kcal ?? targetKcal - eaten)) : 0;
  const over = scored && eaten > targetKcal;
  const wait = !scored ? (day?.targets_wait ?? null) : null;
  const items = (day?.meals ?? []).reduce((n, m) => n + Math.max(1, m.items?.length ?? 0), 0);
  const itemTail = items > 0 ? ` · ${items} ${items === 1 ? 'item' : 'items'}` : '';

  return (
    <>
      {isToday && (
        <div className="fh-dots">
          {weekDates.map((date, i) => {
            const isNow = date === day?.date;
            const logged = loggedDates.has(date) || (isNow && (day?.meals.length ?? 0) > 0);
            return (
              <span className="fh-dot-col" key={date}>
                <span className="fh-dot-l">{DOW[i]}</span>
                {isNow ? (
                  <span className="fh-dot is-today">{Number(date.slice(8))}</span>
                ) : logged ? (
                  <span className="fh-dot is-logged" aria-label={`${date} — logged`}>
                    ✓
                  </span>
                ) : (
                  <span className="fh-dot" />
                )}
              </span>
            );
          })}
        </div>
      )}

      <div className="fh-card">
        <div className="fh-card-row">
          <button className="fh-ringcol fh-ringbtn" onClick={onNutrients} aria-label="Open Nutrients">
            <NutritionRing logged={eaten} target={scored ? targetKcal : null} size={112} stroke={12}>
              {scored && !over ? (
                <>
                  <b>{fmt(left)}</b>
                  <span>KCAL LEFT</span>
                </>
              ) : (
                <>
                  <b>{fmt(eaten)}</b>
                  <span>KCAL EATEN</span>
                </>
              )}
            </NutritionRing>
            <span className="fh-ring-sub">
              {scored
                ? `${fmt(eaten)} of ${fmt(targetKcal)} kcal${itemTail}`
                : wait
                  ? `${wait.days_logged} / ${wait.days_needed} · days to your calorie target`
                  : `no target yet${itemTail}`}
            </span>
          </button>
          <div className="fh-barscol">
            <MacroBars eaten={day?.totals ?? {}} targets={scored ? (day?.targets ?? null) : null} />
            <button className="fh-nutrients" onClick={onNutrients}>
              Nutrients <i aria-hidden>›</i>
            </button>
          </div>
        </div>
        <WaterRow ml={waterMl ?? day?.water_ml ?? 0} onLogged={onWater} readOnly={!isToday} />
      </div>

      {isToday && <NutritionInsightCard compact />}

      {isToday && (
        <>
          <button className="fh-log" onClick={() => onCoach(logNote())}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2.1"
              strokeLinecap="round"
              aria-hidden
            >
              <rect x="2.8" y="6.5" width="18.4" height="13" rx="3" />
              <circle cx="12" cy="13" r="3.6" />
              <path d="M8.5 6.5 9.8 4.2h4.4l1.3 2.3" />
            </svg>
            <span>Log a meal</span>
            <i aria-hidden>›</i>
          </button>

          {hasWeek ? (
            <div className="fh-standing">
              <button className="fh-pill" onClick={() => onSub('week')}>
                This week
              </button>
              <button className="fh-pill" onClick={() => onSub('shop')}>
                Shopping
              </button>
              <button className="fh-pill" onClick={() => onSub('cookbook')}>
                Cookbook
              </button>
            </div>
          ) : (
            <button className="fh-pill fh-pill-wide" onClick={() => onSub('cookbook')}>
              Cookbook{cookbookTail}
            </button>
          )}

          <button className="fh-door" onClick={() => onSub('plan')}>
            <span className="fh-door-t">
              <b>Plan your meals</b>
              <span>a week of dinners, a recipe, or a photo of your fridge</span>
            </span>
            <i aria-hidden>›</i>
          </button>
          <button className="fh-door" onClick={() => onCoach(TALK_NOTE)}>
            <span className="fh-door-t">
              <b>Talk food with me</b>
              <span>targets, allergies, how the week is going</span>
            </span>
            <i aria-hidden>›</i>
          </button>
        </>
      )}

      <FoodDiary
        day={day}
        isToday={isToday}
        confirming={confirming}
        onConfirm={onConfirm}
        onLog={(meal) => onCoach(logNote(meal))}
      />
    </>
  );
}
