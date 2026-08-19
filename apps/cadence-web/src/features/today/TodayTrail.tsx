import { type CSSProperties, type RefObject } from 'react';
import { type PlanViewData, type PlanDay, type PlanOccurrence } from '../../lib/api.ts';
import { TrailFoodStrip } from '../nutrition/TrailFoodStrip.tsx';
import { categoryOf, ICON } from './category.ts';
import { currentNodeIndex, useLandOnNow } from './useLandOnNow.ts';
import { CoachFace } from '../../components/CoachFace.tsx';

/**
 * The Visual Today — the redesign's sky-trail (REQ8 handoff `docs/cadence/design/redesign-today-trail`).
 * The week is one continuous scroll of days, each drawn as a sky that runs dawn → midday → dusk →
 * night; a day's tasks are pressable "disc" nodes laid on a crescent path, tinted by their position
 * in the day (the six-stop tone ramp), desaturated until started/done. Composed entirely from the
 * plan we already load — no new endpoint. This is v1 of the visual system: skies, discs, the tone
 * ramp and the crescent. Coach bay, weather flip, step rings and stars follow.
 */

/** Six-stop tone ramp (dawn→night), authored in oklch in the handoff. Vibrant = main/light/deep;
 *  untouched = the muted m* triplet; the last two stops sit over a dark sky (light type + ring). */
const RAMP = [
  {
    main: '76% 0.15 55',
    light: '87% 0.11 62',
    deep: '60% 0.14 52',
    mL: '77% 0.04 62',
    mM: '68% 0.04 58',
    mD: '57% 0.04 55',
    dark: false,
  },
  {
    main: '79% 0.16 70',
    light: '89% 0.12 78',
    deep: '63% 0.15 68',
    mL: '78% 0.04 76',
    mM: '69% 0.04 70',
    mD: '58% 0.04 68',
    dark: false,
  },
  {
    main: '84% 0.15 90',
    light: '93% 0.10 94',
    deep: '69% 0.14 86',
    mL: '79% 0.04 92',
    mM: '70% 0.04 88',
    mD: '59% 0.04 86',
    dark: false,
  },
  {
    main: '76% 0.12 212',
    light: '88% 0.08 208',
    deep: '61% 0.12 218',
    mL: '77% 0.03 210',
    mM: '68% 0.03 214',
    mD: '57% 0.03 218',
    dark: false,
  },
  {
    main: '64% 0.14 268',
    light: '77% 0.10 266',
    deep: '49% 0.14 268',
    mL: '64% 0.03 266',
    mM: '56% 0.03 268',
    mD: '45% 0.03 268',
    dark: true,
  },
  {
    main: '57% 0.15 266',
    light: '71% 0.11 264',
    deep: '43% 0.14 266',
    mL: '58% 0.03 264',
    mM: '50% 0.03 266',
    mD: '40% 0.03 266',
    dark: true,
  },
];

const FIRST_SKY =
  'linear-gradient(to bottom, oklch(95% 0.04 68) 0%, oklch(96% 0.035 88) 16%, oklch(95% 0.03 210) 36%, oklch(84% 0.06 245) 56%, oklch(58% 0.11 285) 74%, oklch(33% 0.08 272) 88%, oklch(23% 0.06 268) 100%)';
const LATER_SKY =
  'linear-gradient(to bottom, oklch(23% 0.06 266) 0%, oklch(30% 0.09 292) 4%, oklch(48% 0.13 20) 8%, oklch(74% 0.14 46) 13%, oklch(92% 0.07 66) 19%, oklch(96% 0.035 88) 30%, oklch(95% 0.03 210) 46%, oklch(84% 0.06 245) 62%, oklch(58% 0.11 285) 78%, oklch(33% 0.08 272) 91%, oklch(23% 0.06 268) 100%)';

/** Twinkling night stars (bottom 34% of each day), authored per the handoff. */
const STARS = [
  { left: '16%', top: '22%', size: 3, dur: '3.4s' },
  { left: '72%', top: '8%', size: 4, dur: '4.2s' },
  { left: '44%', top: '38%', size: 2, dur: '2.8s' },
  { left: '86%', top: '52%', size: 3, dur: '3.9s' },
  { left: '28%', top: '66%', size: 2, dur: '4.6s' },
  { left: '62%', top: '78%', size: 3, dur: '3.1s' },
];

/** Horizontal crescent offset for node i of n on day d — a half-circle sweep that mirrors each day. */
function crescentX(i: number, n: number, d: number): number {
  const t = n < 2 ? 0.5 : i / (n - 1);
  const dir = d % 2 === 0 ? 1 : -1;
  return Math.round(dir * (-20 + 72 * Math.cos(Math.PI * (t - 0.5))));
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function dayLabel(day: PlanDay, index: number): string {
  const mon = MONTHS[Number(day.date.slice(5, 7)) - 1] ?? '';
  const stamp = `${day.weekday.slice(0, 3).toUpperCase()} ${day.dayNum} ${mon}`;
  if (day.isToday) return `TODAY · ${stamp}`;
  if (index === 1) return `TOMORROW · ${stamp}`;
  return stamp;
}

const COACH_TEXTS = ['Not feeling it? Talk to me.', 'Want to shuffle tomorrow?', "Planning ahead? Let's talk."];

/**
 * The step ring's colour — and the one thing it never said: whether the session happened.
 *
 * It shipped as pure decoration (eb4572c): a segment per prescribed item, stroked by sky darkness
 * alone, faithfully copying a prototype whose own `ringColor` had no done branch either. So a
 * finished session left the ring exactly as grey as one nobody had started, and on device that
 * reads as the finish not registering — owner, 2026-08-16, with the occurrence sitting at
 * `status: 'done'` in the database the whole time. Nothing was stale and no refetch was missing:
 * the ring had no wire to status at all, so no amount of refetching could ever have coloured it.
 * The disc gradient and the ✓ badge had been carrying that whole signal by themselves.
 *
 * Green only for `done`. `skipped` stays grey on purpose — the ring counts what happened, and
 * nothing happened.
 */
function ringStroke(done: boolean, darkSky: boolean): string {
  // The brand's vitality greens, picked by sky: forest disappears into a night sky, sage into noon.
  if (done) return darkSky ? 'var(--sage)' : 'var(--forest)';
  return darkSky ? 'oklch(52% 0.03 262)' : 'oklch(78% 0.02 250)';
}

function TrailNode({
  occ,
  i,
  n,
  d,
  onOpen,
  nodeRef,
}: {
  occ: PlanOccurrence;
  i: number;
  n: number;
  d: number;
  onOpen: (occ: PlanOccurrence) => void;
  /** Set on the one node the trail opens scrolled to — see `useLandOnNow`. */
  nodeRef?: RefObject<HTMLButtonElement>;
}) {
  const cat = categoryOf(occ.title);
  const ramp = RAMP[Math.round((n < 2 ? 0 : i / (n - 1)) * 5)]!;
  const done = occ.status === 'done';
  const touched = done || occ.status === 'skipped';
  const light = touched ? ramp.light : ramp.mL;
  const main = touched ? ramp.main : ramp.mM;
  const deep = touched ? ramp.deep : ramp.mD;
  const face = done
    ? `linear-gradient(168deg, oklch(${main}) 0%, oklch(${deep}) 52%)`
    : `linear-gradient(168deg, oklch(${light}) 0%, oklch(${main}) 52%)`;
  const discStyle = { '--face': face, '--edge': `oklch(${deep})` } as CSSProperties;
  const labelStyle: CSSProperties = ramp.dark ? { color: 'oklch(97% 0.01 265)' } : { color: 'oklch(30% 0.04 250)' };
  const metaStyle: CSSProperties = ramp.dark ? { color: 'oklch(80% 0.03 265)' } : { color: 'oklch(48% 0.03 250)' };

  return (
    <button
      ref={nodeRef}
      className="trail-node"
      style={{ transform: `translateX(${crescentX(i, n, d)}px)` }}
      onClick={() => onOpen(occ)}
      aria-label={occ.title}
    >
      {occ.steps != null && occ.steps > 1 && (
        <svg className="trail-ring" width="104" height="104" viewBox="0 0 104 104" aria-hidden>
          <circle
            cx="52"
            cy="52"
            r="47"
            fill="none"
            pathLength={100}
            stroke={ringStroke(done, ramp.dark)}
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${100 / occ.steps - 4} 4`}
            transform="rotate(-90 52 52)"
          />
        </svg>
      )}
      <span className={`trail-disc${done ? ' is-done' : ''}`} style={discStyle}>
        <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden>
          <path d={ICON[cat]} fill="#fff" />
        </svg>
        {done && (
          <span className="trail-check" aria-hidden>
            ✓
          </span>
        )}
      </span>
      <span className="trail-label" style={labelStyle}>
        {occ.title}
      </span>
      {occ.time_of_day && (
        <span className="trail-meta" style={metaStyle}>
          {occ.time_of_day}
        </span>
      )}
    </button>
  );
}

export function TodayTrail({
  plan,
  onOpen,
  onOpenFood,
  onCoach,
}: {
  plan: PlanViewData;
  onOpen: (occ: PlanOccurrence) => void;
  onOpenFood: () => void;
  onCoach: () => void;
}) {
  const days = plan.week;
  // The one node the trail opens on, and the day it belongs to. Only today has a "now".
  const nowDay = days.findIndex((d) => d.isToday);
  const nowNode = nowDay === -1 ? -1 : currentNodeIndex(days[nowDay]!.occurrences);
  const nowRef = useLandOnNow();

  return (
    <div className="trail">
      {days.map((day, di) => (
        <section
          key={day.date}
          className={`trail-day${di > 0 ? ' is-later' : ''}`}
          style={{ background: di === 0 ? FIRST_SKY : LATER_SKY }}
        >
          {di === 0 ? (
            <div className="trail-sun" aria-hidden />
          ) : (
            <>
              <div className="trail-horizon" aria-hidden />
              <div className="trail-sundisc" aria-hidden />
            </>
          )}
          <div className="trail-moon" aria-hidden />
          <div className="trail-stars" aria-hidden>
            {STARS.map((s, si) => (
              <span
                key={si}
                className="trail-star"
                style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDuration: s.dur }}
              />
            ))}
          </div>
          <div className="trail-daylabel">
            <i />
            <span>{dayLabel(day, di)}</span>
            <i />
          </div>
          {/* Food on the trail (Food Journey 01/3B): one ring, three bars, the day's meal count —
              full width at the top of today, IN the day (2a: a per-day number belongs to the day),
              and absent entirely when food is idle. The bay stays her line and her face. */}
          {day.isToday && <TrailFoodStrip date={day.date} onOpen={onOpenFood} />}
          <div className="trail-nodes">
            {day.occurrences.length === 0 ? (
              <div className="trail-empty">A clear day — rest counts too.</div>
            ) : (
              day.occurrences.map((o, i) => (
                <TrailNode
                  key={o.occurrence_id}
                  occ={o}
                  i={i}
                  n={day.occurrences.length}
                  d={di}
                  onOpen={onOpen}
                  nodeRef={di === nowDay && i === nowNode ? nowRef : undefined}
                />
              ))
            )}
          </div>
          {day.occurrences.length > 0 && (
            /* Top to bottom: her line, then her face. The day's food reads full-width at the
               top of today (TrailFoodStrip) — the 134px bay could never hold three bars. */
            <div className={`trail-bay ${di % 2 === 0 ? 'is-left' : 'is-right'}`}>
              <button className="trail-bay-bubble" onClick={onCoach}>
                {COACH_TEXTS[di % COACH_TEXTS.length]}
              </button>
              <CoachFace size={58} className="trail-bay-mark" />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
