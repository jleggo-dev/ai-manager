/**
 * Retrieval-function registry — the SEMANTIC LAYER (MEMORY-ARCHITECTURE.md §4.1).
 *
 * A bounded set of safe, parameterized queries over the structured store. The model
 * (later, the Scribe in P2) *selects* functions; the app *executes* them. No free SQL.
 * Each function knows how to run, render a compact section, and report a row count for
 * provenance.
 */
import { getUser } from '../../repos/users.ts';
import { listGoalsByStatus } from '../../repos/goals.ts';
import { listEquipment } from '../../repos/equipment.ts';
import { getActivePlan } from '../../repos/plans.ts';
import { listActivities } from '../../repos/activities.ts';
import { listOccurrences, listRecentLogged } from '../../repos/occurrences.ts';
import { listNutritionLogs } from '../../repos/nutrition.ts';
import { buildProgress } from '../progress.ts';
import { summarizeNutrition, renderNutritionLine } from '../nutrition-summarize.ts';
import type { NutritionLog, NutritionSummary, OccurrenceLog, ProgressCard } from '@cadence/shared';

export interface RetrievalFunction {
  name: string;
  description: string; // LLM-facing (catalog / P2 selection)
  domains: string[];
  run(userId: string, params?: Record<string, unknown>): Promise<unknown>;
  render(result: unknown): string; // compact section, or '' to omit
  rows(result: unknown): number; // for provenance
}

function isoRange(days: number): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - days * 86_400_000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}

export const RETRIEVAL_FUNCTIONS: Record<string, RetrievalFunction> = {
  get_identity: {
    name: 'get_identity',
    description: "The user's name, or that it hasn't been captured yet.",
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
    description: 'Active high-level objectives (captured/confirmed/committed goals) with measure + status.',
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
    description: 'Current active plan and its activities (the weekly/daily commitments).',
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
    description: 'How the user showed up over a window: scheduled vs done occurrences. Params: { days }.',
    domains: ['occurrences', 'consistency'],
    async run(userId, params) {
      const days = Math.min(90, Math.max(1, Number(params?.days ?? 7)));
      const { from, to } = isoRange(days);
      const occ = (await listOccurrences(userId, from, to)) as Array<{ status?: string }>;
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
      "The user's recent session reports in their own words — what they actually did (sets/reps/loads/distance) and how it felt. Use when they ask about a past workout/session or how training is going. Params: { days }.",
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
      "COMPUTED progress toward each committed goal (18/100 books, latest vs target weight, days to a milestone, weekly consistency) plus per-activity trends (pace, top load). Use when they ask how they're doing on a goal or overall.",
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
      'Things the user is working around — physical (an injury) or life (burnout, grief, a night shift) — with plan-around flags. Safety-critical for planning.',
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
    description: 'Owned equipment + wear status.',
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
    description: 'Baseline weight (current + start).',
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

  get_food_log: {
    name: 'get_food_log',
    description:
      'Recent meals (last 7 days) with the deterministic food-log summary (days logged, meals/day, common items, alcohol days). Use for "how has my eating been?" or any food/nutrition question.',
    domains: ['nutrition'],
    async run(userId) {
      const { from, to } = isoRange(7);
      const meals = await listNutritionLogs(userId, from, to);
      return { meals, summary: summarizeNutrition(meals, 7) };
    },
    render(r) {
      const { meals, summary } = r as { meals: NutritionLog[]; summary: NutritionSummary };
      if (!meals.length) return 'Food log: nothing logged in the last 7 days.';
      const recent = meals
        .slice(0, 10)
        .map(
          (m) => `- ${m.date} ${m.meal}: ${m.items.map((i) => i.name).join(', ') || (m.raw_text ?? '').slice(0, 60)}`,
        )
        .join('\n');
      return [renderNutritionLine(summary), recent].filter(Boolean).join('\n');
    },
    rows(r) {
      return (r as { meals: unknown[] }).meals.length;
    },
  },
};
