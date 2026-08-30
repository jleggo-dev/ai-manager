/**
 * Retrieval-function registry — the SEMANTIC LAYER (MEMORY-ARCHITECTURE.md §4.1).
 *
 * A bounded set of safe, parameterized queries over the structured store. The model
 * (later, the Broker in P2) *selects* functions; the app *executes* them. No free SQL.
 * Each function knows how to run, render a compact section, and report a row count for
 * provenance.
 */
import {
  budgetNote,
  sessionBudget,
  type GoalArea,
  type OccurrenceLog,
  type ProgressCard,
  formatWeight,
  type WeightUnit,
  resolveUnit,
} from '@cadence/shared';
import { getUser } from '../../repos/users.ts';
import { listGoals, listGoalsByStatus } from '../../repos/goals.ts';
import { listEquipment } from '../../repos/equipment.ts';
import { getActivePlan } from '../../repos/plans.ts';
import { listActivities } from '../../repos/activities.ts';
import { listLoggedForProgress, listOccurrences, listRecentLogged } from '../../repos/occurrences.ts';
import { buildProgress } from '../progress.ts';
import { activityHandle, ANYTIME } from '../plan-edit.ts';
import { describeRecurrence } from '../scheduling.ts';
import { FOOD_HEALTH_FUNCTIONS } from './food-health-functions.ts';
import { CHECK_FOOD_SOURCES } from './food-sources-function.ts';
import { RESOLVE_PORTION } from './portion-function.ts';
import { READ_LABEL } from './label-function.ts';
import { GET_NUTRITION } from './nutrition-facade.ts';
import { PREVIEW_MEAL } from './food-log-function.ts';
import { RESEARCH_FOOD } from './food-research-function.ts';
import { isoRange, type RetrievalFunction } from './types.ts';

// Re-exported so the many existing importers of this module keep working unchanged.
export type { RetrievalFunction } from './types.ts';

/** " two days ago" / " today" — how long the current plan version has stood. Relative, because an
 *  absolute date makes the coach do arithmetic she gets wrong; empty when the row predates
 *  `generated_at` being populated, since a wrong "today" is worse than no date at all. */
function changedWhen(plan: Record<string, unknown>): string {
  const at = plan.generated_at;
  const t = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : NaN;
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return ' today';
  if (days === 1) return ' yesterday';
  if (days < 14) return ` ${days} days ago`;
  return ` ${Math.floor(days / 7)} weeks ago`;
}

/**
 * WHEN a commitment happens, as one clause: the days, the time of day, and how long.
 *
 * Until 2026-08-17 this line carried the raw recurrence rule and nothing else — no time, and no
 * sign when a commitment had none. Both cost a real conversation the same day: an "Easy run" whose
 * `time_of_day` was NULL rendered exactly like one at 07:00, so when the owner asked three times
 * why the time was not set, the coach could not see that anything was missing to offer to fix. And
 * with two commitments both called "Easy run", the rule string was all that told them apart.
 *
 * THE RAW RRULE IS GONE, deliberately. `describeRecurrence` runs on the same `parseRecurrence` that
 * `expandRecurrence` uses to materialize the calendar, so the humanized string is lossless about
 * what the app actually honours — anything the description drops, the scheduler drops too, and
 * printing the rest would tell her something untrue about the week. Nor is it an input she can use:
 * `propose_plan_change` takes days as WORDS (`days: ["friday"]`), which is exactly this vocabulary.
 * It was ~10 tokens of developer noise per commitment, on every turn, buying nothing.
 */
function commitmentWhen(schedule: unknown, area: GoalArea | undefined): string {
  const s = (schedule ?? {}) as { recurrence?: unknown; time_of_day?: unknown; duration_min?: unknown };
  const rrule = typeof s.recurrence === 'string' ? s.recurrence.trim() : '';
  // A blank recurrence never fires (the per-plan off-plan bucket), so "One-time" would be a lie.
  const days = rrule ? describeRecurrence(rrule) : 'no repeat set';
  /**
   * "No time set" and "any time" are DIFFERENT FACTS and must never render alike (plan-edit.ts):
   * `anytime` is a decision someone made — this one floats — and a blank is a hole in the plan.
   * Collapsing them IS the bug, because a hole that reads as a choice is a hole nobody offers to
   * fill.
   */
  const t = typeof s.time_of_day === 'string' ? s.time_of_day.trim() : '';
  const time = !t ? 'no time set' : t === ANYTIME ? 'any time' : t;
  /**
   * `duration_min` is the EFFORT since the owner's 2026-08-17 ruling, not the whole session, so a
   * bare number is now ambiguous and gets named. `budgetNote` adds the time to actually set aside
   * — the thing the owner said he wanted to know — and stays silent when the work needs no warm-up,
   * so a meal log, or a commitment with no goal to take an area from, costs nothing extra.
   */
  const budget = sessionBudget(typeof s.duration_min === 'number' ? s.duration_min : null, area);
  const effort = budget ? ` · ${budget.effort_min} min effort ${budgetNote(budget)}`.trimEnd() : '';
  return `${days} · ${time}${effort}`;
}

/** The dossier core: who they are, what they're for, what the plan says, how it's going. */
const CORE_FUNCTIONS: Record<string, RetrievalFunction> = {
  get_identity: {
    name: 'get_identity',
    description:
      "The user's name, if they have shared one. Use before addressing them by name; if this comes back empty, ask them rather than guessing.",
    domains: ['identity'],
    async run(userId) {
      const u = await getUser(userId);
      return { name: u?.name?.trim() || null };
    },
    render(r) {
      const name = (r as { name: string | null }).name;
      return name
        ? `Name: ${name}`
        : 'Name: (name not captured — ask the user their name before addressing them by one)';
    },
    rows(r) {
      return (r as { name: string | null }).name ? 1 : 0;
    },
  },

  get_objectives: {
    name: 'get_objectives',
    description:
      'What the user is working toward — every active goal — from ones just mentioned in conversation to ones committed into the plan — each with its target. Use when you need to know what their goals ARE; for numbers on how each is GOING, use get_goal_progress.',
    domains: ['goals'],
    async run(userId) {
      return listGoalsByStatus(userId, ['captured', 'confirmed', 'committed']);
    },
    render(r) {
      const goals = r as Array<Record<string, unknown>>;
      if (!goals.length) return '';
      const lines = goals.map((g) => {
        const m = g.measure as { target?: unknown; unit?: unknown } | undefined;
        const measure = m?.target != null ? ` · target ${String(m.target)}${m.unit ? ` ${String(m.unit)}` : ''}` : '';
        return `  - ${String(g.title)} [${String(g.area)}/${String(g.type)}, ${String(g.status)}]${measure}`;
      });
      return `Objectives (${goals.length}):\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as unknown[]).length;
    },
  },

  get_active_plan: {
    name: 'get_active_plan',
    description:
      'The user\'s current plan: the sessions and habits they committed to, each with the days it repeats on, its time of day, and its length — "Easy run — Tue · 07:00 · 40 min effort (allow 50)" is a 40-min run at 7am Tuesdays, needing 50 minutes of their morning. "no time set" means none has been picked yet; say so and offer to. Also gives what they last asked to change and when. Use for what their week is SUPPOSED to look like; for whether they actually did it, use get_consistency.',
    domains: ['plans', 'activities'],
    async run(userId) {
      const plan = await getActivePlan(userId);
      if (!plan) return { plan: null, activities: [], areaByGoal: {} };
      /**
       * Two independent reads, issued together rather than one after the other, because this
       * function runs on EVERY turn (coach-tool-tiers.ts `ALWAYS_READS`) and the goals are here
       * only to resolve each commitment's AREA — the thing that turns the stored effort into the
       * time to set aside. plan-view.ts resolves it the same way, for the same reason.
       */
      const [activities, goals] = await Promise.all([listActivities(plan.plan_id), listGoals(userId)]);
      const areaByGoal: Record<string, GoalArea> = {};
      for (const g of goals) if (g.area) areaByGoal[g.goal_id] = g.area;
      return { plan, activities, areaByGoal };
    },
    render(r) {
      const { plan, activities, areaByGoal } = r as {
        plan: Record<string, unknown> | null;
        activities: Array<Record<string, unknown>>;
        areaByGoal?: Record<string, GoalArea>;
      };
      if (!plan) return '';
      /**
       * The HANDLE leads every line. It is what `propose_plan_change` addresses commitments by,
       * and until 2026-08-17 it did not exist: the plan rendered as titles alone, so a plan
       * holding two "Easy run" rows gave the coach no way to say which one she meant, and the
       * edit engine picked for her. A read that names a thing must hand back the way to name it.
       */
      const lines = activities.map((a) => {
        const handle = activityHandle(String(a.commitment_id ?? ''));
        const area = typeof a.goal_id === 'string' ? areaByGoal?.[a.goal_id] : undefined;
        return `  - ${handle} [${String(a.kind)}] ${String(a.title)} — ${commitmentWhen(a.schedule, area)}`;
      });
      // The steer is why this version exists, in the user's own words (0034). Without it a plan
      // adjusted through the "Custom — let's talk" sheet reaches chat as an unexplained different
      // week, and she re-litigates a decision they already made with her.
      const steer = typeof plan.steer === 'string' ? plan.steer.trim() : '';
      const changed = steer ? `\nThey asked for this version themselves${changedWhen(plan)}: "${steer}"` : '';
      return `Current plan v${String(plan.version)} (${activities.length} commitments):\n${lines.join('\n')}${changed}`;
    },
    rows(r) {
      return (r as { activities: unknown[] }).activities.length;
    },
  },

  get_consistency: {
    name: 'get_consistency',
    description:
      'How reliably the user has been doing what they planned: of the sessions scheduled in the last N days, how many actually happened — a count and a percentage. Use for "how have I been keeping up?" — the follow-through number, not what the sessions contained. Defaults to the last 7 days; pass {"days": 30} to look further back (up to 90).',
    domains: ['occurrences', 'consistency'],
    async run(userId, params) {
      const days = Math.min(90, Math.max(1, Number(params?.days ?? 7)));
      const { from, to } = isoRange(days);
      const occ = await listOccurrences(userId, from, to);
      const scheduled = occ.length;
      const done = occ.filter((o) => o.status === 'done').length;
      return { days, scheduled, done, pct: scheduled ? Math.round((done / scheduled) * 100) : null };
    },
    render(r) {
      const a = r as { days: number; scheduled: number; done: number; pct: number | null };
      if (a.pct === null) return '';
      return `Consistency (last ${a.days}d): ${a.pct}% (${a.done}/${a.scheduled} showed up)`;
    },
    rows(r) {
      return (r as { scheduled: number }).scheduled;
    },
  },

  get_recent_logs: {
    name: 'get_recent_logs',
    description:
      'What the user wrote down after recent sessions, in their own words — what they actually did (sets, reps, distances) and how it felt. Returns the most recent few reports (up to 6). Use when they ask about a specific past session or how training has FELT lately; for the device-recorded list of every workout, use get_workout_history. Pass {"days": 30} to look further back (default 14, up to 90).',
    domains: ['occurrences', 'logs'],
    async run(userId, params) {
      const days = Math.min(90, Math.max(1, Number(params?.days ?? 14)));
      return listRecentLogged(userId, days, 6);
    },
    render(r) {
      const rows = r as Array<{ date: string; title: string; log: OccurrenceLog }>;
      if (!rows.length) return '';
      const lines = rows.map((x) => {
        const felt = x.log.items.find((i) => i.felt)?.felt;
        return `- ${x.date} · ${x.title}: ${x.log.summary}${felt ? ` (felt ${felt})` : ''}`;
      });
      /**
       * The provenance travels WITH the data, because a PREFETCHED block arrives without the tool
       * description that would otherwise carry it. This one's description already says these are
       * the user's own write-ups and points at `get_workout_history` for the device record — but
       * she only ever reads a description when she goes looking for the tool, and the Broker hands
       * this straight into the pack.
       *
       * Measured 2026-08-29: asked "what's my longest run in the last month? not the average, the
       * actual longest", she answered "11.4 km on August 23" in 3 of 4 samples, calling nothing.
       * 11.4 km was the longest run the user had WRITTEN UP; his watch had recorded a 13.2 km run
       * he never logged. Specific, confident, and wrong by 1.8 km — off a block that looked
       * complete and never said it wasn't.
       */
      return [
        'Recent session reports — the write-ups they did themselves, most recent few only.',
        'NOT a complete record of what they did: sessions they never wrote up are absent entirely,',
        'and anything their watch recorded lives in get_workout_history. Never answer "how far",',
        '"how long" or "how many" from this alone — read it for what they SAID, not for totals.',
        lines.join('\n'),
      ].join('\n');
    },
    rows(r) {
      return (r as unknown[]).length;
    },
  },

  get_goal_progress: {
    name: 'get_goal_progress',
    description:
      "Numbers on how each goal is going, worked out from what the user has logged — 18 of 100 books read, current weight vs target, days left to a deadline, sessions kept per week — plus trends over time (pace, top lift) and the latest accomplishments recorded by name. Use when they ask how they're doing on a goal or overall. For whether they showed up at all, use get_consistency; for raw totals of one counted thing, use get_practice_totals.",
    domains: ['goals', 'progress'],
    async run(userId) {
      const p = await buildProgress(userId);
      return {
        cards: p.cards,
        trends: p.trends.map((t) => ({
          title: t.title,
          label: t.label,
          unit: t.unit,
          first: t.series[0],
          last: t.series[t.series.length - 1],
        })),
        // Completions only — the ledger also holds 'note' rows ("Target changed: 100 → 50"),
        // which are bookkeeping, not accomplishments, and must never render as cheer.
        events: (p.events ?? [])
          .filter((e) => e.kind === 'completion')
          .slice(0, 6)
          .map((e) => ({ label: e.label, at: e.at })),
      };
    },
    render(r) {
      const { cards, trends, events } = r as {
        cards: ProgressCard[];
        trends: Array<{
          title: string;
          label: string;
          unit: string;
          first?: { value: number };
          last?: { value: number };
        }>;
        events?: Array<{ label: string; at: string }>;
      };
      const lines: string[] = [];
      for (const c of cards) {
        if (c.kind === 'count') lines.push(`- ${c.title}: ${c.current}/${c.target} ${c.unit}`);
        else if (c.kind === 'latest_vs_target')
          lines.push(`- ${c.title}: now ${c.latest ?? '?'} ${c.unit} (started ${c.start ?? '?'}, target ${c.target})`);
        else if (c.kind === 'countdown')
          lines.push(
            `- ${c.title}: ${c.days_left} days out; stepping-stones ${c.milestones_done}/${c.milestones_total}`,
          );
        else if (c.kind === 'consistency') lines.push(`- ${c.title}: showed up ${c.kept} of ${c.window} days`);
      }
      for (const t of trends) {
        if (t.first && t.last)
          lines.push(`- ${t.title} ${t.label.toLowerCase()}: ${t.first.value} → ${t.last.value} ${t.unit}`);
      }
      // The ledger's own words, not only its count. These labels used to be dropped here — she
      // could say "18/100" but never name WHICH — so a list the user had already given could
      // only be asked for again. The heading says how many ride along, so six lines beside an
      // "18/100" card never read as the whole eighteen. Dates are relative day-counts, not
      // calendar days: the server clock is UTC and a local-looking date would be wrong for
      // anyone west of it by evening.
      const evs = events ?? [];
      if (evs.length) lines.push(`Recorded by name (the ${evs.length} most recent):`);
      for (const e of evs) {
        const t = Date.parse(e.at);
        const days = Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : NaN;
        const when = Number.isNaN(days)
          ? ''
          : days <= 0
            ? ' (today)'
            : days === 1
              ? ' (yesterday)'
              : ` (${days} days ago)`;
        lines.push(`- ${e.label}${when}`);
      }
      return lines.length ? `Goal progress (computed):\n${lines.join('\n')}` : '';
    },
    rows(r) {
      const x = r as { cards: unknown[]; trends: unknown[]; events?: unknown[] };
      return x.cards.length + x.trends.length + (x.events?.length ?? 0);
    },
  },

  get_constraints: {
    name: 'get_constraints',
    description:
      "Things the user is working around and the plan must respect — physical (a bad knee, a shoulder) or life circumstances (burnout, grief, a night shift). Use before proposing or changing any training, every time; if something here would make a suggestion unsafe, don't make it.",
    domains: ['baseline'],
    async run(userId) {
      const u = await getUser(userId);
      return (u?.baseline?.constraints ?? []) as unknown as Array<Record<string, unknown>>;
    },
    render(r) {
      const cons = r as Array<Record<string, unknown>>;
      if (!cons.length) return '';
      const list = cons
        // Legacy rows may still carry {area, condition} instead of label.
        .map((c) =>
          `${String(c.label ?? [c.area, c.condition].filter(Boolean).join(' — '))}${c.plan_around ? ' [plan-around]' : ''}`.trim(),
        )
        .join('; ');
      return `What we work around: ${list}`;
    },
    rows(r) {
      return (r as unknown[]).length;
    },
  },

  get_equipment: {
    name: 'get_equipment',
    description:
      'What training equipment the user owns — and for tracked items like running shoes, how used up they are (distance so far vs the replacement point). Use before suggesting sessions that need gear, or when they ask about their equipment.',
    domains: ['equipment'],
    async run(userId) {
      return listEquipment(userId);
    },
    render(r) {
      const eq = r as Array<Record<string, unknown>>;
      if (!eq.length) return '';
      const list = eq
        .map((e) => {
          const w = e.wear as { accumulated_km?: unknown; threshold_km?: unknown; status?: unknown } | undefined;
          return `${String(e.name)}${w ? ` (${String(w.accumulated_km)}/${String(w.threshold_km)}km ${String(w.status)})` : ''}`;
        })
        .join(', ');
      return `Equipment: ${list}`;
    },
    rows(r) {
      return (r as unknown[]).length;
    },
  },

  get_weight: {
    name: 'get_weight',
    description:
      "The user's body facts: current weight and, when recorded, the weight they started at, plus height " +
      'and age when those are on file. Use before any calculation or conversation involving their body — ' +
      'targets, pacing, load — and read the WEIGHT BACK IN THE UNIT SHOWN, which is the one they use. If a ' +
      'fact comes back missing, ask them for it rather than estimating.',
    domains: ['baseline'],
    async run(userId) {
      const u = await getUser(userId);
      const b = (u?.baseline ?? {}) as {
        weight_kg?: { current?: number; start?: number };
        weight_unit?: unknown;
        height_cm?: number;
        age?: number;
      };
      return {
        current: b.weight_kg?.current ?? null,
        start: b.weight_kg?.start ?? null,
        // Through the resolver, so the Settings control reaches her: an explicit `unit_prefs`
        // choice wins, then the legacy `baseline.weight_unit`, then the system fallback.
        unit: resolveUnit(u?.unit_prefs, 'body_weight', b.weight_unit) as WeightUnit,
        height_cm: b.height_cm ?? null,
        age: b.age ?? null,
      };
    },
    /**
     * In THEIR unit, and with the rest of the body facts beside it.
     *
     * Two things were wrong here, both reported by the owner on 2026-08-22 after the first
     * successful target-setting:
     *
     *  - It printed `kg` unconditionally. He gave his weight in pounds, was told it back in kilos,
     *    and got coached in metric from then on. `baseline.weight_unit` records what he said and
     *    `progress.ts` already honoured it; this path never looked.
     *
     *    CONVERTED HERE, NOT EXPLAINED TO HER. The first fix appended "talk about weight in lb, it
     *    is the unit they gave" — which is a rule to follow, spends tokens on every turn forever,
     *    and can be got wrong. Owner's correction, and it is the better design: convert at the
     *    boundary and hand over a number that is already right. The unit is in the string; there
     *    is nothing left to reason about.
     *  - Height and age were on file and NO tool returned them, so she had to ask for both — the
     *    "never makes you repeat yourself" promise, broken by omission rather than by design. They
     *    come from the same `getUser` call this already makes, so carrying them is free.
     */
    render(r) {
      const w = r as {
        current?: number | null;
        start?: number | null;
        unit?: WeightUnit;
        height_cm?: number | null;
        age?: number | null;
      } | null;
      if (!w) return '';
      const unit = w.unit ?? 'kg';
      const bits: string[] = [];
      if (w.current) {
        bits.push(
          `Weight: ${formatWeight(w.current, unit)}${w.start ? ` (start ${formatWeight(w.start, unit)})` : ''}`,
        );
      }
      if (w.height_cm) bits.push(`Height: ${String(w.height_cm)}cm`);
      if (w.age) bits.push(`Age: ${String(w.age)}`);
      return bits.join(' · ');
    },
    rows(r) {
      const w = r as { current?: unknown } | null;
      return w?.current ? 1 : 0;
    },
  },

  /**
   * The countable side of a practice, added up.
   *
   * Session logs already capture whatever numbers someone reports — the parser writes them to
   * `occurrences.value` as free-form metric keys — but nothing ever totalled them, so "how much
   * have I actually written this month" had no answer even though every session knew its own.
   * Deliberately metric-agnostic: words and minutes are why it exists (the mind and practice
   * pillars, where progress is not a weight or a pace), but reps and pages ride the same path
   * for free, and a metric this app has never heard of will still total correctly.
   */
  get_practice_totals: {
    name: 'get_practice_totals',
    description:
      'Running totals of anything the user has counted in their session logs, per activity — words written, minutes meditated, pages read, reps done. Use for "how much have I written this month?" and for practice goals whose progress is a count they log rather than a weight or a pace. Reports up to a dozen totals, most-logged first. For overall goal numbers, use get_goal_progress. Pass {"days": 90} to set the period (default 30, up to 365).',
    domains: ['occurrences', 'progress', 'mind', 'practice'],
    async run(userId, params) {
      const days = Math.min(365, Math.max(1, Number(params?.days ?? 30)));
      const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const rows = await listLoggedForProgress(userId, from);
      const totals = new Map<string, { title: string; metric: string; total: number; sessions: number }>();
      for (const r of rows) {
        for (const [metric, v] of Object.entries(r.value ?? {})) {
          if (!Number.isFinite(v)) continue;
          const key = `${r.title}|${metric}`;
          const cur = totals.get(key) ?? { title: r.title, metric, total: 0, sessions: 0 };
          cur.total += v;
          cur.sessions += 1;
          totals.set(key, cur);
        }
      }
      return { days, totals: [...totals.values()].sort((a, b) => b.sessions - a.sessions) };
    },
    render(r) {
      const { days, totals } = r as {
        days: number;
        totals: Array<{ title: string; metric: string; total: number; sessions: number }>;
      };
      if (!totals.length) return '';
      const lines = totals.slice(0, 12).map((t) => {
        const n = Number.isInteger(t.total) ? t.total.toLocaleString('en-US') : t.total.toFixed(1);
        return `- ${t.title} · ${t.metric.replace(/_/g, ' ')}: ${n} across ${t.sessions} session${t.sessions === 1 ? '' : 's'}`;
      });
      return `What they have counted (last ${days}d):\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as { totals: unknown[] }).totals.length;
    },
  },
};

/**
 * The one map every caller reads. Composed from the two groups rather than written out, so a new
 * function lands in whichever file owns its data source and nothing here has to change.
 */
export const RETRIEVAL_FUNCTIONS: Record<string, RetrievalFunction> = {
  ...CORE_FUNCTIONS,
  ...FOOD_HEALTH_FUNCTIONS,
  [CHECK_FOOD_SOURCES.name]: CHECK_FOOD_SOURCES,
  [RESOLVE_PORTION.name]: RESOLVE_PORTION,
  // MP14: reads a photo attached this turn (routes/coach.ts, MP13's photo_ref) — a nutrition panel
  // or a front-of-package shot, via the vision jobs check_food_sources cannot reach.
  [READ_LABEL.name]: READ_LABEL,
  // One door for every food question (nutrition-facade.ts). The four it dispatches to stay in the
  // registry — the Broker may still prefetch any of them — but `find_tools` lists only this.
  [GET_NUTRITION.name]: GET_NUTRITION,
  // The Coach's write surface (MP21/MP40/MP27, FOOD-ENGINE.md §7 §8): read-into-a-meal and the
  // web-grounded rung she can call herself. `log_meal` (the commit half) is an ACTION and lives in
  // coach-actions.ts, not here — only the two reads join the registry.
  [PREVIEW_MEAL.name]: PREVIEW_MEAL,
  [RESEARCH_FOOD.name]: RESEARCH_FOOD,
};
