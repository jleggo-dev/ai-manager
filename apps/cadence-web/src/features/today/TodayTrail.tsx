import { useEffect, useState, type CSSProperties } from 'react';
import { getTodayBrief, type PlanViewData, type PlanDay, type PlanOccurrence } from '../../lib/api.ts';
import { TrailFoodStrip } from '../nutrition/TrailFoodStrip.tsx';
import { categoryOf, ICON } from './category.ts';
import { useFitText } from './useFitText.ts';

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

const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
function ordinal(n: number): string {
  const v = n % 100;
  const suffix = v >= 11 && v <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}
function prettyDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS_FULL[(m ?? 1) - 1]} ${ordinal(d ?? 1)}`;
}
const COACH_TEXTS = ['Not feeling it? Talk to me.', 'Want to shuffle tomorrow?', "Planning ahead? Let's talk."];
const LEAF =
  'M20.6 3.4C7.6 4.6 3.4 12.9 4.6 19.2c1.5-3.6 4.2-6.8 8.6-9.4-3.4 2.9-5.4 6.2-6.5 9.9 6.2 1.2 14.7-3.1 13.9-16.3Z';

function TrailNode({
  occ,
  i,
  n,
  d,
  onOpen,
}: {
  occ: PlanOccurrence;
  i: number;
  n: number;
  d: number;
  onOpen: (occ: PlanOccurrence) => void;
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
            stroke={ramp.dark ? 'oklch(52% 0.03 262)' : 'oklch(78% 0.02 250)'}
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
  const todayDate = days.find((d) => d.isToday)?.date ?? new Date().toISOString().slice(0, 10);
  const todayPretty = prettyDate(todayDate);
  const [recap, setRecap] = useState<string | null>(null);
  // Deterministic 2-line guarantee: shrink the whole line to fit even if the recap runs long.
  const fit = useFitText(`${todayPretty}|${recap ?? ''}`);
  useEffect(() => {
    let alive = true;
    void getTodayBrief().then((b) => {
      if (alive) setRecap(b.recap);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="trail">
      <TrailFoodStrip date={todayDate} onOpen={onOpenFood} />
      <div className="trail-coach">
        <svg className="stroke" viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path d="M20 11.5a7.5 7.5 0 01-10.9 6.7L4 19l1-4.3A7.5 7.5 0 1120 11.5z" strokeLinejoin="round" />
        </svg>
        <span ref={fit.ref} style={{ fontSize: `${fit.size}px` }}>
          <b>It&apos;s {todayPretty} —</b>{' '}
          <span style={{ opacity: recap ? 1 : 0.9, transition: 'opacity 0.4s ease' }}>
            {recap ?? 'everything here is a suggestion; start wherever feels right.'}
          </span>
        </span>
      </div>

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
          <div className="trail-nodes">
            {day.occurrences.length === 0 ? (
              <div className="trail-empty">A clear day — rest counts too.</div>
            ) : (
              day.occurrences.map((o, i) => (
                <TrailNode key={o.occurrence_id} occ={o} i={i} n={day.occurrences.length} d={di} onOpen={onOpen} />
              ))
            )}
          </div>
          {day.occurrences.length > 0 && (
            <div className={`trail-bay ${di % 2 === 0 ? 'is-left' : 'is-right'}`}>
              <div className="trail-bay-mark" aria-hidden>
                <svg viewBox="0 0 24 24" width="30" height="30">
                  <path d={LEAF} fill="#fff" />
                </svg>
              </div>
              <button className="trail-bay-bubble" onClick={onCoach}>
                {COACH_TEXTS[di % COACH_TEXTS.length]}
              </button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
