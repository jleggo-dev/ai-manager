import { useEffect, useState } from 'react';
import type { ProgressData, ProgressCard } from '@cadence/shared';
import { Ring, DotRow, CountBar, Sparkline, MacroRings } from '../../components/viz.tsx';
import {
  getProgress,
  getNutritionDay,
  getRecentMeals,
  addGoalEvent,
  type PlanViewData,
  type PlanOccurrence,
  type PlanDay,
  type NutritionDayData,
} from '../../lib/api.ts';

/**
 * The Visual Today — a module dashboard, not a week list. STABLE CHROME, VARIABLE CONTENT: every
 * card is gated by (area, goal type, data presence), so a books-and-prayer user never sees a
 * macro ring and a runner-with-food sees rings + a consistency ring but no reading bar. Composed
 * ENTIRELY client-side from /plan (passed in) + /progress + /nutrition/day — no LLM, no new
 * aggregate endpoint (S6). The plan drives the rhythm card + check-off (handlers come from the
 * parent, which owns the session sheets); the two aux fetches refresh when `reloadKey` bumps.
 */

const isFood = (t: string) => /food|meal|nutrition/i.test(t);
const isWeigh = (t: string) => /weigh/i.test(t);

type Mod = 'nutrition' | 'weigh' | 'session';
const occMod = (o: PlanOccurrence): Mod => (isFood(o.title) ? 'nutrition' : isWeigh(o.title) ? 'weigh' : 'session');

/** A quiet module glyph so the day's checklist reads at a glance (the "module icon" of S6 #1). */
function ModIcon({ mod }: { mod: Mod }) {
  if (mod === 'nutrition') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <circle className="stroke" cx="8" cy="8" r="6" />
        <circle className="stroke" cx="8" cy="8" r="2.2" />
      </svg>
    );
  }
  if (mod === 'weigh') {
    return (
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <path className="stroke" d="M2.5 11a5.5 5.5 0 0 1 11 0" strokeLinecap="round" />
        <path className="stroke" d="M8 11l3-3.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path className="stroke" d="M2.5 10.5l3.2-5 2.6 3 2.4-4.4L14 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Dashboard sort: movement rings first, then counts, practice dots, measured, milestones —
 *  the S6 registry order. Nourishment consistency is dropped (the Nutrition card owns that area). */
function rank(c: ProgressCard): number {
  if (c.kind === 'consistency') return c.area === 'movement' ? 0 : 2;
  if (c.kind === 'count') return 1;
  if (c.kind === 'latest_vs_target') return 3;
  return 4; // countdown
}

export function TodayDashboard({
  plan,
  reloadKey,
  onCheck,
  onOpen,
}: {
  plan: PlanViewData;
  reloadKey: number;
  onCheck: (o: PlanOccurrence, status: 'pending' | 'done' | 'skipped') => void;
  onOpen: (occId: string) => void;
}) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [nutrition, setNutrition] = useState<NutritionDayData | null>(null);
  const [recentDays, setRecentDays] = useState(0);
  const [addFor, setAddFor] = useState<string | null>(null);
  const [addLabel, setAddLabel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getProgress().then(setProgress).catch(() => setProgress({ cards: [], trends: [], history: [] }));
    getNutritionDay().then(setNutrition).catch(() => setNutrition(null));
    getRecentMeals(7)
      .then((ms) => setRecentDays(new Set(ms.map((m) => m.date)).size))
      .catch(() => {});
  }, [reloadKey]);

  async function submitAdd(goalId: string) {
    const label = addLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      await addGoalEvent(goalId, label);
      setAddFor(null);
      setAddLabel('');
      getProgress().then(setProgress).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const today = plan.week.find((d) => d.isToday);
  const todaysOccs = today?.occurrences ?? [];
  const nextUp = plan.week
    .filter((d) => !d.isToday)
    .flatMap((d) => d.occurrences.filter((o) => o.status === 'pending').map((o) => ({ o, d })))[0] as
    | { o: PlanOccurrence; d: PlanDay }
    | undefined;

  const cards = [...(progress?.cards ?? [])].sort((a, b) => rank(a) - rank(b));
  const trends = progress?.trends ?? [];

  const todayFoodOcc = todaysOccs.find((o) => isFood(o.title));
  const hasFoodInPlan = plan.week.some((d) => d.occurrences.some((o) => isFood(o.title)));
  // The API returns `{}` (not null) for an unset user, and `{}` is truthy — so gate on an
  // ACTUAL macro value. No real target → the observe card, never empty "0g left" rings.
  const targets =
    nutrition?.targets && (nutrition.targets.kcal || nutrition.targets.protein_g || nutrition.targets.carbs_g || nutrition.targets.fat_g)
      ? nutrition.targets
      : null;
  const nutritionEngaged = !!nutrition && (!!targets || nutrition.meals.length > 0 || recentDays > 0 || hasFoodInPlan);

  const RhythmRow = ({ o }: { o: PlanOccurrence }) => {
    const done = o.status === 'done';
    const skipped = o.status === 'skipped';
    const openable = o.kind === 'user' || isFood(o.title) || isWeigh(o.title);
    return (
      <div className={`occ${done ? ' occ-done' : ''}${skipped ? ' occ-skip' : ''}`}>
        <button className="occ-check" onClick={() => onCheck(o, done ? 'pending' : 'done')} aria-label={done ? 'Mark not done' : 'Mark done'}>
          {done ? '✓' : skipped ? '–' : ''}
        </button>
        <span className={`occ-mod occ-mod-${occMod(o)}`}>
          <ModIcon mod={occMod(o)} />
        </span>
        {openable ? (
          <button className="occ-body occ-open" onClick={() => onOpen(o.occurrence_id)} title="Open">
            <span className="occ-title">{o.title}</span>
            {o.time_of_day && <span className="occ-time">{o.time_of_day}</span>}
          </button>
        ) : (
          <div className="occ-body">
            <span className="occ-title">{o.title}</span>
            {o.time_of_day && <span className="occ-time">{o.time_of_day}</span>}
          </div>
        )}
        {!done && (
          <button className="occ-skipbtn" onClick={() => onCheck(o, skipped ? 'pending' : 'skipped')}>
            {skipped ? 'undo' : 'skip'}
          </button>
        )}
      </div>
    );
  };

  const DashCard = ({ c }: { c: ProgressCard }) => {
    if (c.kind === 'consistency') {
      if (c.area === 'nourishment') return null; // the Nutrition card owns this area
      if (c.area === 'movement') {
        return (
          <div className="prog-card dash-ringcard">
            <Ring fraction={c.window > 0 ? c.kept / c.window : 0} color="var(--forest)" size={70}>
              <span className="ring-n">{c.kept}<i>/{c.window}</i></span>
            </Ring>
            <div className="dash-ringcard-t">
              <div className="prog-title">{c.title}</div>
              <div className="prog-sub">{c.kept === 0 ? 'a fresh week' : `showed up ${c.kept} of ${c.window} days`}</div>
            </div>
          </div>
        );
      }
      const dots = Array.from({ length: c.window }, (_, i) => i < c.kept);
      return (
        <div className="prog-card">
          <div className="prog-title">{c.title}</div>
          <DotRow dots={dots} color="var(--sage)" />
          <div className="prog-sub">{c.kept === 0 ? 'a fresh week — a missed day is information, not failure' : `${c.kept} of ${c.window} days this week`}</div>
        </div>
      );
    }
    if (c.kind === 'count') {
      return (
        <div className="prog-card">
          <div className="prog-title">{c.title}</div>
          <div className="prog-big">
            {c.current}<span className="prog-unit">/{c.target} {c.unit}</span>
          </div>
          <CountBar current={c.current} target={c.target} />
          {addFor === c.goal_id ? (
            <div className="prog-add">
              <input
                className="wiz-in"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitAdd(c.goal_id)}
                placeholder="What did you finish? e.g. Dune"
                disabled={busy}
                autoFocus
              />
              <button className="logbox-btn" onClick={() => submitAdd(c.goal_id)} disabled={busy || !addLabel.trim()}>Add</button>
            </div>
          ) : (
            <button className="prog-addbtn" onClick={() => { setAddFor(c.goal_id); setAddLabel(''); }}>+ add one</button>
          )}
        </div>
      );
    }
    if (c.kind === 'latest_vs_target') {
      const dir = c.start !== null && c.latest !== null ? (c.latest < c.start ? '↓' : c.latest > c.start ? '↑' : '→') : '';
      return (
        <div className="prog-card">
          <div className="prog-title">{c.title}</div>
          <div className="prog-trend-row">
            <div>
              <div className="prog-big">
                {c.latest ?? '—'} <span className="prog-unit">{c.unit}</span> {dir && <span className="prog-dir">{dir}</span>}
              </div>
              <div className="prog-sub">{c.start !== null ? `started ${c.start}` : 'no start yet'} · target {c.target}</div>
            </div>
            {c.series.length >= 2 && <Sparkline series={c.series} good="down" />}
          </div>
        </div>
      );
    }
    // countdown
    const stones = c.milestones_total > 0;
    return (
      <div className="prog-card">
        <div className="prog-title">{c.title}</div>
        <div className="prog-big">
          {c.days_left}<span className="prog-unit"> days out</span>
        </div>
        {stones && (
          <>
            <CountBar current={c.milestones_done} target={c.milestones_total} />
            <div className="prog-sub">stepping-stones {c.milestones_done}/{c.milestones_total} · {c.end}</div>
          </>
        )}
        {!stones && <div className="prog-sub">{c.end}</div>}
      </div>
    );
  };

  return (
    <>
      {/* 1 — Today's rhythm: the anchor card, always first. */}
      <div className="prog-card dash-rhythm">
        <div className="dash-h">
          <b>Today's rhythm</b>
          <span>{today ? `${today.weekday} ${today.dayNum}` : ''}</span>
        </div>
        {todaysOccs.length === 0 ? (
          <div className="pd-empty">Your day's clear — rest counts too.</div>
        ) : (
          todaysOccs.map((o) => <RhythmRow key={o.occurrence_id} o={o} />)
        )}
        {nextUp && (
          <div className="dash-next">
            Next up · <b>{nextUp.o.title}</b> · {nextUp.d.weekday}
          </div>
        )}
      </div>

      {/* 2 — Nutrition: macro rings once targets exist, else the observe card. */}
      {nutritionEngaged && nutrition && (
        <div className="prog-card">
          <div className="dash-h">
            <b>Nutrition</b>
            <span>{targets ? 'today' : 'observing'}</span>
          </div>
          {targets ? (
            <MacroRings totals={nutrition.totals} targets={targets} left={nutrition.left} />
          ) : (
            <div className="dash-observe">
              <DotRow dots={Array.from({ length: 7 }, (_, i) => i < Math.min(7, recentDays))} color="var(--dawn-3)" />
              <div className="prog-sub">
                {recentDays === 0 ? 'No meals logged yet this week' : `Logged ${recentDays} of the last 7 days`}
                {nutrition.meals.length > 0 ? ` · ${nutrition.meals.length} today` : ''}
              </div>
            </div>
          )}
          {todayFoodOcc && (
            <button className="dash-snap" onClick={() => onOpen(todayFoodOcc.occurrence_id)}>
              📷 Log a meal
            </button>
          )}
        </div>
      )}

      {/* 3–7 — everything else derives from /progress, ordered by the S6 registry. */}
      {cards.map((c, i) => <DashCard key={i} c={c} />)}

      {/* Movement trends (pace / top load) — self-contained sparklines, no goal-matching needed. */}
      {trends.map((t, i) => (
        <div className="prog-card" key={`t${i}`}>
          <div className="prog-trend-row">
            <div>
              <div className="prog-title" style={{ marginBottom: 2 }}>{t.title}</div>
              <div className="prog-big" style={{ fontSize: 20 }}>
                {t.series[t.series.length - 1]!.value}<span className="prog-unit"> {t.unit}</span>
              </div>
              <div className="prog-sub">{t.label.toLowerCase()} · was {t.series[0]!.value}</div>
            </div>
            <Sparkline series={t.series} good={t.direction_good} />
          </div>
        </div>
      ))}
    </>
  );
}
