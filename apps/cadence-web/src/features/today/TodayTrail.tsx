import type { CSSProperties } from 'react';
import type { PlanViewData, PlanDay, PlanOccurrence } from '../../lib/api.ts';
import { isFoodTitle } from '../../components/occurrence-mod.ts';

/**
 * The Visual Today — the redesign's sky-trail (REQ8 handoff `docs/cadence/design/redesign-today-trail`).
 * The week is one continuous scroll of days, each drawn as a sky that runs dawn → midday → dusk →
 * night; a day's tasks are pressable "disc" nodes laid on a crescent path, tinted by their position
 * in the day (the six-stop tone ramp), desaturated until started/done. Composed entirely from the
 * plan we already load — no new endpoint. This is v1 of the visual system: skies, discs, the tone
 * ramp and the crescent. Coach bay, weather flip, step rings and stars follow.
 */

type Category = 'mindset' | 'movement' | 'nutrition' | 'reflection';

/** No area on the plan occurrence yet, so infer the icon family from the title (v1). */
function categoryOf(title: string): Category {
  if (isFoodTitle(title)) return 'nutrition';
  const t = title.toLowerCase();
  if (/reflect|journal|gratitude|wind.?down|evening|night|sleep/.test(t)) return 'reflection';
  if (/mindset|meditat|breath|calm|focus|intention|morning|check-in/.test(t)) return 'mindset';
  if (/run|walk|jog|workout|strength|lift|ride|swim|cycl|mobility|yoga|stretch|cardio|hiit|zone|row/.test(t))
    return 'movement';
  return 'movement';
}

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

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/* ── Solid-white glyphs (filled silhouettes on the discs) ─────────────────────────────── */
const ICON: Record<Category, string> = {
  mindset:
    'M12 4a1 1 0 011 1v1a1 1 0 01-2 0V5a1 1 0 011-1zm0 12a1 1 0 011 1v1a1 1 0 01-2 0v-1a1 1 0 011-1zM4 11h1a1 1 0 010 2H4a1 1 0 010-2zm14 0h1a1 1 0 010 2h-1a1 1 0 010-2zM6.2 6.2a1 1 0 011.4 0l.7.7A1 1 0 016.9 8.3l-.7-.7a1 1 0 010-1.4zm9.3 9.3a1 1 0 011.4 0l.7.7a1 1 0 01-1.4 1.4l-.7-.7a1 1 0 010-1.4zm1.4-9.3a1 1 0 010 1.4l-.7.7a1 1 0 01-1.4-1.4l.7-.7a1 1 0 011.4 0zM6.9 15.7a1 1 0 010 1.4l-.7.7a1 1 0 01-1.4-1.4l.7-.7a1 1 0 011.4 0zM12 8a4 4 0 100 8 4 4 0 000-8z',
  movement:
    'M14.5 5.5a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0zM9 9.2l3.4-1.3a1.6 1.6 0 011.7.4l2 2.1 2.1.8a1 1 0 01-.7 1.9l-2.5-1a1.6 1.6 0 01-.5-.4l-.8-.9-1 3 2.2 2.4.9 3.6a1.1 1.1 0 01-2.1.6l-.9-3.4-2.9-3a1.6 1.6 0 01-.4-1.4l.3-1.6-1.6.6-1.2 2.2a1 1 0 01-1.8-.9l1.4-2.6a1.6 1.6 0 01.9-.7z',
  nutrition:
    'M12 6.5c.7-1.6 2.3-2.6 3.9-2.3-.2 1.2-1 2.3-2.1 2.8 1.8-.3 3.6.7 4.4 2.4 1 2.4.1 5.6-1.7 7.8-.8 1-1.7 1.6-2.6 1.4-.6-.1-1-.4-1.9-.4s-1.3.3-1.9.4c-.9.2-1.8-.4-2.6-1.4C5.9 17.4 5 14.2 6 11.8c.8-1.8 2.7-2.8 4.6-2.3-.7-.4-1.3-1.1-1.6-1.9 1.3-.2 2.6.3 3 .9z',
  reflection: 'M20 13.5A8 8 0 019 4.2a1 1 0 00-1.3-1.1A9.5 9.5 0 1021 15a1 1 0 00-1-1.5z',
};
const LEAF =
  'M18 4C11 4 5.5 8 5.5 15c0 2 .6 3.6 1.4 4.8C9 15 12.5 12 18 11c-4.5 2-7.5 5.5-9 10.5.9.3 1.9.5 3 .5 7 0 11-6 11-13 0-2-.5-3.7-1.5-5H18z';

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
  onOpen: (id: string) => void;
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
      onClick={() => onOpen(occ.occurrence_id)}
      aria-label={occ.title}
    >
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

export function TodayTrail({ plan, onOpen }: { plan: PlanViewData; onOpen: (occId: string) => void }) {
  const days = plan.week;
  const streak = plan.streak?.current ?? 0;

  return (
    <div className="trail">
      <div className="trail-head">
        <div className="trail-avatar" aria-hidden>
          <svg viewBox="0 0 24 24" width="21" height="21">
            <path d={LEAF} fill="#fff" />
          </svg>
        </div>
        <div className="trail-greet">
          <b>{greeting()}</b>
          <span>{days.find((d) => d.isToday)?.weekday ?? ''}</span>
        </div>
        {streak > 0 && (
          <div className="trail-streak" aria-label={`${streak} day streak`}>
            <span aria-hidden>🔥</span>
            {streak}
          </div>
        )}
      </div>

      <div className="trail-coach">
        <svg className="stroke" viewBox="0 0 24 24" width="20" height="20" aria-hidden>
          <path d="M20 11.5a7.5 7.5 0 01-10.9 6.7L4 19l1-4.3A7.5 7.5 0 1120 11.5z" strokeLinejoin="round" />
        </svg>
        <span>Everything here is a suggestion — start wherever feels right.</span>
      </div>

      {days.map((day, di) => (
        <section
          key={day.date}
          className={`trail-day${di > 0 ? ' is-later' : ''}`}
          style={{ background: di === 0 ? FIRST_SKY : LATER_SKY }}
        >
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
        </section>
      ))}
    </div>
  );
}
