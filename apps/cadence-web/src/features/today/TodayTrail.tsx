import { type CSSProperties, type RefObject, useState } from 'react';
import type { ClockUnit } from '@cadence/shared';
import { type PlanViewData, type PlanOccurrence } from '../../lib/api.ts';
import { formatClock } from '../../lib/clock.ts';
import { dayLabel, daySide } from './dayLabel.ts';
import { useClockUnit, useEarlierDays } from '../../lib/query/index.ts';
import { MAX_EARLIER_WEEKS } from '../../lib/query/useEarlierDays.ts';
import { isWeeklyCheckin } from '../plan/occurrence/format.ts';
import { taskOpener } from '../plan/taskShape.ts';
import { TrailFoodStrip } from '../nutrition/TrailFoodStrip.tsx';
import { glyphOf } from './glyphs.ts';
import { currentNodeIndex, useLandOnNow } from './useLandOnNow.ts';
import { useKeepScrollOnPrepend } from './useKeepScrollOnPrepend.ts';
import { useLongPress } from './useLongPress.ts';
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
    /**
     * Light type again under Linen, and derived rather than eyeballed: a node's ramp index is its
     * order in the day (`i / (n - 1) * 5`), so this stop sits ~80% down the sky — which the old
     * ramp made 0.58 lightness (dark, white type) and Linen makes **0.74** (light). It is the same
     * rule the header obeys at the same height: `skyTint`'s 0.62 seam leaves the band cream there,
     * so white labels beside it would have been the one thing that did not get the memo — pale text
     * on a pale sky. Quieting the sky costs one row of light type; that is the trade, and this is
     * where it lands.
     */
    dark: false,
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

/**
 * **Linen** (Plan Screen turn 3, option 3b — owner's pick 2026-08-19): the same eleven stops at the
 * same positions, so no trail geometry moves; only the sky quiets down.
 *
 * The shipped ramp peaked at chroma 0.14 twice a day — a hot sunrise band and a violet dusk — which
 * is why it read loud and why the floating header had to flip to dark chrome for about a third of
 * every scroll. Linen peaks at **0.055** and lets brand do the pulling: the sun (`--sun` #D85A30)
 * chalked back rather than blazing, and **`--dusk` #3E5C76 as the night floor instead of an
 * invented indigo**. Night is now dim, not black, so the discs never sit in a hole — and the discs
 * themselves are untouched (RAMP above), because the content is what should carry the colour.
 *
 * `skyTint.ts` transcribes the L of every stop below. Move one here, move it there.
 */
const FIRST_SKY =
  'linear-gradient(to bottom, oklch(95% 0.022 74) 0%, oklch(97% 0.018 88) 16%, oklch(96% 0.016 200) 36%, oklch(91% 0.028 235) 56%, oklch(76% 0.045 248) 74%, oklch(56% 0.045 246) 88%, oklch(46% 0.042 245) 100%)';
const LATER_SKY =
  'linear-gradient(to bottom, oklch(46% 0.042 245) 0%, oklch(52% 0.05 262) 4%, oklch(63% 0.055 28) 8%, oklch(80% 0.055 52) 13%, oklch(93% 0.032 72) 19%, oklch(97% 0.018 88) 30%, oklch(96% 0.016 200) 46%, oklch(91% 0.028 235) 62%, oklch(76% 0.045 248) 78%, oklch(56% 0.045 246) 91%, oklch(46% 0.042 245) 100%)';

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
  date,
  i,
  n,
  d,
  onOpen,
  onHold,
  nodeRef,
  clock,
}: {
  occ: PlanOccurrence;
  /** The day this node sits on — the list row carries no date of its own. */
  date: string;
  i: number;
  n: number;
  d: number;
  onOpen: (occ: PlanOccurrence, date: string) => void;
  /** Press-and-hold → the hold menu (2026-09-07). Absent, the node only taps. */
  onHold?: (occ: PlanOccurrence, date: string) => void;
  /** Set on the one node the trail opens scrolled to — see `useLandOnNow`. */
  nodeRef?: RefObject<HTMLButtonElement>;
  /** How the time under the disc is written (Settings → Units → Clock). */
  clock: ClockUnit;
}) {
  const hold = useLongPress(onHold ? () => onHold(occ, date) : undefined);
  // The goal's AREA is authoritative for the family when present (piano wore the exercise glyph
  // for want of it, 2026-08-31); the title picks the specific glyph within it (glyphs.ts).
  const glyph = glyphOf(occ.title, occ.area);
  const ramp = RAMP[Math.round((n < 2 ? 0 : i / (n - 1)) * 5)]!;
  const done = occ.status === 'done';
  /**
   * The session hasn't been written yet (Gap 4, PLAN-CHANGES.md): this disc used to render like
   * any other, so the ~30-60s write was discovered by tapping. The hint is a dashed ring in the
   * step ring's own slot — the ring is the trail's session voice, and a sketched one says "still
   * being drawn" without a word or a spinner; the sheet narrates the wait on tap as it always
   * has. Only rows whose tap actually starts the write get it (`taskOpener === 'task'` — captures
   * and food tasks never have a session), only while pending, and never on an older server that
   * doesn't send the field (absence is a no-claim). Mutually exclusive with the step ring by
   * construction: `steps` comes from the session, so a missing session can't have any.
   */
  const warming = occ.session_ready === false && occ.status === 'pending' && taskOpener(occ) === 'task';
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
      {...hold}
      onClick={() => onOpen(occ, date)}
      aria-label={warming ? `${occ.title} — still being written` : occ.title}
    >
      {warming && (
        <svg className="trail-ring is-warming" width="104" height="104" viewBox="0 0 104 104" aria-hidden>
          <circle
            cx="52"
            cy="52"
            r="47"
            fill="none"
            pathLength={100}
            stroke={ringStroke(false, ramp.dark)}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="2 5"
            transform="rotate(-90 52 52)"
          />
        </svg>
      )}
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
          <path d={glyph.d} fill="#fff" />
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
          {formatClock(occ.time_of_day, clock)}
        </span>
      )}
    </button>
  );
}

export function TodayTrail({
  plan,
  onOpen,
  onHold,
  onOpenFood,
  onCoach,
}: {
  plan: PlanViewData;
  /** A tap, with the day it landed on — the caller decides what a future day's tap means. */
  onOpen: (occ: PlanOccurrence, date: string) => void;
  /** A press-and-hold, same shape. Optional: with none wired the nodes only tap. */
  onHold?: (occ: PlanOccurrence, date: string) => void;
  onOpenFood: () => void;
  onCoach: () => void;
}) {
  // The synthesized "Weekly check-in" system row is retired from the trail (check-in rebuild, step
  // 7): the new end-of-trail card is its replacement, and the two must not compete on the same
  // screen. Visual only — the row (and its occurrence) still exists server-side; this just never
  // renders it. Filtered once, up front, so every downstream index (the crescent geometry, the
  // "now" node) already agrees with what's on screen — filtering later would shift them apart.
  //
  // The trail opens on today and runs forward; the weeks BEFORE today load on top of it one tap
  // at a time (owner, 2026-09-01: "there should be a mechanism to see previous days… so I can
  // enter in missed data"). They come from the server in the same day shape, so the same nodes
  // draw them and the same sheets open on tap — a breakfast forgotten on Monday is logged on
  // Monday's card, on Monday's date.
  const clock = useClockUnit();
  const [weeksBack, setWeeksBack] = useState(0);
  const earlier = useEarlierDays(weeksBack);
  const trailRef = useKeepScrollOnPrepend(earlier.days.length);
  const days = [...earlier.days, ...plan.week].map((d) => ({
    ...d,
    occurrences: d.occurrences.filter((o) => !isWeeklyCheckin(o)),
  }));
  // The one node the trail opens on, and the day it belongs to. Only today has a "now".
  const nowDay = days.findIndex((d) => d.isToday);
  const nowNode = nowDay === -1 ? -1 : currentNodeIndex(days[nowDay]!.occurrences);
  const nowRef = useLandOnNow();

  return (
    <div className="trail" ref={trailRef}>
      <div className="trail-earlier">
        {weeksBack >= MAX_EARLIER_WEEKS ? (
          <span className="trail-earlier-end">That&rsquo;s as far back as the trail goes.</span>
        ) : (
          <button
            type="button"
            className="trail-earlier-btn"
            onClick={() => setWeeksBack((w) => w + 1)}
            disabled={earlier.loading}
          >
            {earlier.loading ? 'Looking back…' : weeksBack === 0 ? '↑ See last week' : '↑ See the week before'}
          </button>
        )}
        {earlier.failed && <span className="trail-earlier-end">Couldn&rsquo;t load that week — try again.</span>}
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
            <span>{dayLabel(day, di, nowDay)}</span>
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
                  date={day.date}
                  i={i}
                  n={day.occurrences.length}
                  d={daySide(day.date)}
                  onOpen={onOpen}
                  onHold={onHold}
                  nodeRef={di === nowDay && i === nowNode ? nowRef : undefined}
                  clock={clock}
                />
              ))
            )}
          </div>
          {day.occurrences.length > 0 && (
            /* Top to bottom: her line, then her face. The day's food reads full-width at the
               top of today (TrailFoodStrip) — the 134px bay could never hold three bars. */
            <div className={`trail-bay ${daySide(day.date) === 0 ? 'is-left' : 'is-right'}`}>
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
