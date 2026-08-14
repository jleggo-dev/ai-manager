/**
 * Retrieval-function registry — the SEMANTIC LAYER (MEMORY-ARCHITECTURE.md §4.1).
 *
 * A bounded set of safe, parameterized queries over the structured store. The model
 * (later, the Broker in P2) *selects* functions; the app *executes* them. No free SQL.
 * Each function knows how to run, render a compact section, and report a row count for
 * provenance.
 */
import type { OccurrenceLog, ProgressCard } from '@cadence/shared';
import { getUser } from '../../repos/users.ts';
import { listGoalsByStatus } from '../../repos/goals.ts';
import { listEquipment } from '../../repos/equipment.ts';
import { getActivePlan } from '../../repos/plans.ts';
import { listActivities } from '../../repos/activities.ts';
import { listLoggedForProgress, listOccurrences, listRecentLogged } from '../../repos/occurrences.ts';
import { buildProgress } from '../progress.ts';
import { FOOD_HEALTH_FUNCTIONS } from './food-health-functions.ts';
import { isoRange, type RetrievalFunction } from './types.ts';

// Re-exported so the many existing importers of this module keep working unchanged.
export type { RetrievalFunction } from './types.ts';

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
      "The user's current plan: the sessions and habits they committed to, with how often each repeats (e.g. run — 3x per week). Use when you need what their week is SUPPOSED to look like; for whether they actually did it, use get_consistency.",
    domains: ['plans', 'activities'],
    async run(userId) {
      const plan = await getActivePlan(userId);
      const activities = plan ? await listActivities(plan.plan_id) : [];
      return { plan, activities };
    },
    render(r) {
      const { plan, activities } = r as {
        plan: Record<string, unknown> | null;
        activities: Array<Record<string, unknown>>;
      };
      if (!plan) return '';
      const lines = activities.map((a) => {
        const sched = a.schedule as { recurrence?: unknown } | undefined;
        return `  - [${String(a.kind)}] ${String(a.title)} — ${sched?.recurrence ? String(sched.recurrence) : ''}`;
      });
      return `Current plan v${String(plan.version)} (${activities.length} commitments):\n${lines.join('\n')}`;
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
      return `Recent session reports:\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as unknown[]).length;
    },
  },

  get_goal_progress: {
    name: 'get_goal_progress',
    description:
      "Numbers on how each goal is going, worked out from what the user has logged — 18 of 100 books read, current weight vs target, days left to a deadline, sessions kept per week — plus trends over time (pace, top lift). Use when they ask how they're doing on a goal or overall. For whether they showed up at all, use get_consistency; for raw totals of one counted thing, use get_practice_totals.",
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
      };
    },
    render(r) {
      const { cards, trends } = r as {
        cards: ProgressCard[];
        trends: Array<{
          title: string;
          label: string;
          unit: string;
          first?: { value: number };
          last?: { value: number };
        }>;
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
      return lines.length ? `Goal progress (computed):\n${lines.join('\n')}` : '';
    },
    rows(r) {
      const x = r as { cards: unknown[]; trends: unknown[] };
      return x.cards.length + x.trends.length;
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
      "The user's current weight and, when recorded, the weight they started at. Use before any calculation or conversation involving their weight; if it comes back empty, ask them rather than estimating.",
    domains: ['baseline'],
    async run(userId) {
      const u = await getUser(userId);
      return (u?.baseline?.weight_kg ?? null) as { current?: unknown; start?: unknown } | null;
    },
    render(r) {
      const w = r as { current?: unknown; start?: unknown } | null;
      if (!w?.current) return '';
      return `Weight: ${String(w.current)}kg${w.start ? ` (start ${String(w.start)})` : ''}`;
    },
    rows(r) {
      return r ? 1 : 0;
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
      'Running totals of anything the user has counted in their session logs, per activity — words written, minutes meditated, pages read, reps done. Use for "how much have I written this month?" and for practice goals whose progress is a count they log rather than a weight or a pace. For overall goal numbers, use get_goal_progress. Pass {"days": 90} to set the period (default 30, up to 365).',
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
};
