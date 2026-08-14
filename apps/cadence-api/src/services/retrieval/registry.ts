/**
 * Retrieval-function registry — the SEMANTIC LAYER (MEMORY-ARCHITECTURE.md §4.1).
 *
 * A bounded set of safe, parameterized queries over the structured store. The model
 * (later, the Broker in P2) *selects* functions; the app *executes* them. No free SQL.
 * Each function knows how to run, render a compact section, and report a row count for
 * provenance.
 */
import type {
  DietaryProfile,
  EatingWindow,
  Food,
  NutritionLog,
  NutritionSummary,
  OccurrenceLog,
  ProgressCard,
} from '@cadence/shared';
import { EMPTY_DIETARY_PROFILE, sanitizeDietaryProfile } from '@cadence/shared';
import { getUser, getDietaryProfile } from '../../repos/users.ts';
import { listGoalsByStatus } from '../../repos/goals.ts';
import { listEquipment } from '../../repos/equipment.ts';
import { getActivePlan } from '../../repos/plans.ts';
import { listActivities } from '../../repos/activities.ts';
import { listOccurrences, listRecentLogged } from '../../repos/occurrences.ts';
import { listNutritionLogs } from '../../repos/nutrition.ts';
import { listForCoach } from '../../repos/journal-entries.ts';
import { latestHealthDigest } from '../../repos/health-digests.ts';
import { listWorkoutHistory, type WorkoutHistoryRow } from '../../repos/workout-history.ts';
import { renderHealthDigest } from '../health-context.ts';
import { buildProgress } from '../progress.ts';
import { summarizeNutrition, renderNutritionLine } from '../nutrition-summarize.ts';
import { searchFoodsWithUsda } from '../food-sources/usda-enrich.ts';
import { renderEatingWindow } from './eating-window-line.ts';

/** What `get_dietary_profile` returns: what they can't eat, plus when they eat. */
interface DietaryPlusWindow {
  profile: DietaryProfile;
  eating_window: EatingWindow | null;
}

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

  /**
   * Req 5 Phase 3 — deterministic food lookup (local cache + USDA enrich).
   * Read-only; no LLM job wrapping HTTP. OFF barcodes stay on the browser path.
   */
  lookup_food: {
    name: 'lookup_food',
    description:
      "Look up foods by name in the user's cache + shared DB (incl. USDA whole foods on cache miss). Use when they ask what something is / macros / micros, or before suggesting a food. Params: { q: string, limit?: number }. Not for barcodes (Food tab handles OFF).",
    domains: ['nutrition', 'foods'],
    async run(userId, params) {
      const q = typeof params?.q === 'string' ? params.q.trim() : '';
      if (!q) return { q: '', foods: [] as Food[] };
      const limit = Math.min(10, Math.max(1, Number(params?.limit ?? 5) || 5));
      const foods = await searchFoodsWithUsda(userId, q, limit);
      return { q, foods };
    },
    render(r) {
      const { q, foods } = r as { q: string; foods: Food[] };
      if (!q) return 'Food lookup: pass q (food name).';
      if (!foods.length) return `Food lookup "${q}": no matches in cache/USDA yet.`;
      const lines = foods.slice(0, 8).map((f) => {
        const m = f.macros_per_base ?? {};
        const brand = f.brand ? ` (${f.brand})` : '';
        const macros = [
          typeof m.kcal === 'number' ? `${Math.round(m.kcal)} kcal` : null,
          typeof m.protein_g === 'number' ? `P${Math.round(m.protein_g)}` : null,
          typeof m.zinc_mg === 'number' ? `Zn ${m.zinc_mg}mg` : null,
          typeof m.iron_mg === 'number' ? `Fe ${m.iron_mg}mg` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const per = f.base_unit === 'item' ? '/item' : '/100' + f.base_unit;
        return `- ${f.name}${brand} [${f.source}] ${macros}${macros ? ` ${per}` : ''}`;
      });
      return `Food lookup "${q}" (${foods.length}):\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as { foods: unknown[] }).foods.length;
    },
  },

  /**
   * The journal, as the coach may read it (REQ9 §4.5). This is the ONLY path journal words take
   * into a context pack, and it goes through `listForCoach` — which excludes secret entries and
   * paper rows in SQL. That is the whole privacy promise made mechanical: there is no argument to
   * this function that could widen it, and turning the key removes an entry from the very next
   * pack build.
   *
   * Words, verbatim, newest first — never themes, never sentiment, never a count. What the coach
   * does with them is remember ("three weeks ago you wrote…"), which is the entire point of the
   * store; a compression layer over these (REQ9 §12's parse_mind_log) only earns its place once
   * volume makes raw entries too big for a pack, exactly like REQ7's rollups.
   */
  get_journal: {
    name: 'get_journal',
    description:
      'Recent journal entries the user has written, in their own words (secret entries are never included). Use when they refer to something they wrote, when a pattern across entries would help, or to remember what mattered to them lately.',
    domains: ['journal', 'mind'],
    async run(userId, params) {
      const limit = typeof params?.limit === 'number' ? Math.min(20, Math.max(1, params.limit)) : 8;
      return listForCoach(userId, limit);
    },
    render(r) {
      const entries = r as Array<{ created_at: string; prompt: string | null; body: string }>;
      if (!entries.length) return '';
      const lines = entries.map((e) => {
        const date = e.created_at.slice(0, 10);
        const q = e.prompt ? ` (asked: ${e.prompt})` : '';
        return `  - ${date}${q}: ${e.body.replace(/\s+/g, ' ').slice(0, 300)}`;
      });
      return `Journal — their own words, most recent first:\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as unknown[]).length;
    },
  },

  /**
   * WHAT they eat and WHEN — two facts from two different columns, deliberately in one place.
   *
   * `dietary_profile` is a safety input (hard allergen excludes). `baseline.eating_window` is how
   * someone has chosen to eat, and it belongs nowhere near the allergen list as STORAGE — but this
   * is the moment both matter, "before suggesting foods/recipes", and minting a fifteenth retrieval
   * function for one line would mean a catalog change and a selection the model has to remember to
   * make. Storage stays apart; the render joins them.
   */
  get_dietary_profile: {
    name: 'get_dietary_profile',
    description:
      'Allergies (hard excludes), diet pattern (vegan/vegetarian/…), soft dislikes, and the hours they eat in (16:8, OMAD, Ramadan) when they have said. Use before suggesting foods/recipes and when the user mentions allergies, diet, or meal timing.',
    domains: ['nutrition', 'safety'],
    async run(userId) {
      const [raw, user] = await Promise.all([getDietaryProfile(userId), getUser(userId)]);
      return {
        profile: sanitizeDietaryProfile(raw) ?? { ...EMPTY_DIETARY_PROFILE },
        eating_window: user?.baseline?.eating_window ?? null,
      };
    },
    render(r) {
      const { profile: p, eating_window: w } = r as DietaryPlusWindow;
      const bits: string[] = [];
      if (p.allergies.length) bits.push(`allergies (hard): ${p.allergies.join(', ')}`);
      if (p.diet) bits.push(`diet: ${p.diet}`);
      if (p.dislikes.length) bits.push(`dislikes: ${p.dislikes.join(', ')}`);
      if (p.notes?.trim()) bits.push(`notes: ${p.notes.trim()}`);
      const head = bits.length
        ? `Dietary profile: ${bits.join('; ')}`
        : 'Dietary profile: none set yet (ask before first recipe if relevant).';
      const window = renderEatingWindow(w);
      return window ? `${head}\n${window}` : head;
    },
    rows(r) {
      const { profile: p, eating_window: w } = r as DietaryPlusWindow;
      return (
        p.allergies.length + p.dislikes.length + (p.diet ? 1 : 0) + (p.notes?.trim() ? 1 : 0) + (w?.said_as ? 1 : 0)
      );
    },
  },

  get_health_history: {
    name: 'get_health_history',
    description:
      'Recent activity the user shared from Apple Health — workouts by type with weekly frequency. Use during onboarding instead of asking them to type their workout history, and whenever what they actually did recently matters.',
    domains: ['movement', 'history'],
    async run(userId) {
      return latestHealthDigest(userId);
    },
    render(r) {
      const row = r as Awaited<ReturnType<typeof latestHealthDigest>>;
      if (!row) return '';
      return renderHealthDigest(row.digest, row.createdAt);
    },
    rows(r) {
      const row = r as Awaited<ReturnType<typeof latestHealthDigest>>;
      return row ? row.digest.totalWorkouts : 0;
    },
  },

  get_workout_history: {
    name: 'get_workout_history',
    description:
      "Individual recorded workouts from the user's devices (Apple Health), newest first — date, type, duration, distance. The session-by-session log behind get_health_history's summary. Use when WHICH days or sessions matters: what they did this morning, this week's actual runs, the gap since the last one. Params: { days }.",
    domains: ['movement', 'history'],
    async run(userId, params) {
      const days = Math.min(90, Math.max(1, Number(params?.days ?? 30)));
      return { days, workouts: await listWorkoutHistory(userId, days, 40) };
    },
    render(r) {
      const { days, workouts } = r as { days: number; workouts: WorkoutHistoryRow[] };
      if (!workouts.length) return '';
      const lines = workouts.map((w) => {
        const bits = [w.type];
        if (w.durationMin != null) bits.push(`${Math.round(w.durationMin)} min`);
        if (w.distanceKm != null) bits.push(`${w.distanceKm} km`);
        if (w.avgHr != null) bits.push(`avg ${Math.round(w.avgHr)} bpm`);
        return `- ${w.startedAt.slice(0, 10)} · ${bits.join(' · ')}`;
      });
      return `Recorded workouts (last ${days}d, newest first):\n${lines.join('\n')}`;
    },
    rows(r) {
      return (r as { workouts: WorkoutHistoryRow[] }).workouts.length;
    },
  },
};
