import { getUser } from '../repos/users.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { summarizeNutrition, renderNutritionLine } from './nutrition-summarize.ts';

export interface DossierInput {
  userId: string;
  lastNDays?: number;
}

/**
 * Compile the SYSTEM / DOSSIER block of the Coach context packet (spec §4.3),
 * rendered DETERMINISTICALLY from the structured store (the source of truth) —
 * baseline + active goals + equipment + current plan summary + last-N-days
 * adherence. Stable and cheap; the transcript stays ephemeral.
 *
 * TODO: active disrupted episode summary + just-in-time records (context_select).
 */
export async function compileDossier(input: DossierInput): Promise<string> {
  const { userId } = input;
  const lastN = input.lastNDays ?? 7;

  const [user, goals, equipment, plan] = await Promise.all([
    getUser(userId),
    listGoalsByStatus(userId, ['confirmed', 'committed']),
    listEquipment(userId),
    getActivePlan(userId),
  ]);
  const activities = plan ? await listActivities(plan.plan_id) : [];

  const now = new Date();
  const from = new Date(now.getTime() - lastN * 86_400_000).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const occ = await listOccurrences(userId, from, to);
  const done = occ.filter((o) => o.status === 'done').length;
  const consistencyPct = occ.length ? Math.round((done / occ.length) * 100) : null;

  const name = user?.name?.trim();
  const lines: string[] = name
    ? [`# ${name}`]
    : ['# (name not captured yet — ask the user their name before addressing them by one)'];

  const b = user?.baseline;
  if (b) {
    const bits: string[] = [];
    if (b.age) bits.push(`age ${b.age}`);
    if (b.weight_kg) bits.push(`weight ${b.weight_kg.current}kg (start ${b.weight_kg.start})`);
    if (b.constraints?.length)
      bits.push(
        `working around: ${b.constraints
          .map((c) => `${c.label}${c.plan_around ? ' [plan-around]' : ''}`)
          .join('; ')}`,
      );
    if (bits.length) lines.push(`Baseline: ${bits.join(' · ')}`);
  }

  if (goals.length) {
    lines.push(`Active goals (${goals.length}):`);
    for (const g of goals) lines.push(`  - ${g.title} [${g.area}/${g.type}, ${g.status}]`);
  }

  if (equipment.length) {
    lines.push(
      `Equipment: ${equipment
        .map((e) => e.name + (e.wear ? ` (${e.wear.accumulated_km}/${e.wear.threshold_km}km ${e.wear.status})` : ''))
        .join(', ')}`,
    );
  }

  if (plan) {
    // Commit recency tells the persona whether this plan is NEW (walk the ladder, invite
    // pushback) or established. String() guards the postgres.js Date-object trap.
    const committedAt = new Date(String(plan.generated_at ?? ''));
    const daysAgo = Number.isNaN(committedAt.getTime())
      ? null
      : Math.max(0, Math.floor((now.getTime() - committedAt.getTime()) / 86_400_000));
    lines.push(
      `Current plan v${plan.version} (${activities.length} commitments${
        daysAgo != null ? `, committed ${daysAgo === 0 ? 'today' : `${daysAgo}d ago`}` : ''
      }):`,
    );
    // The objective→commitment ladder (§6.3): each goal's commitments — with the stored why —
    // under the goal they serve; foundational/system work last. This is the exact shape the
    // coach walks in chat ("For your 10k: ... because ...").
    const renderAct = (a: (typeof activities)[number]) =>
      `    - [${a.kind}] ${a.title} — ${a.schedule?.recurrence ?? ''}${a.why ? ` · why: ${a.why}` : ''}`;
    const linkedIds = new Set<string>();
    for (const g of goals) {
      const acts = activities.filter((a) => a.goal_id === g.goal_id);
      if (!acts.length) continue;
      lines.push(`  Toward "${g.title}":`);
      for (const a of acts) {
        lines.push(renderAct(a));
        linkedIds.add(a.activity_id);
      }
    }
    const foundations = activities.filter((a) => !linkedIds.has(a.activity_id));
    if (foundations.length) {
      lines.push('  Foundations (whole-plan):');
      for (const a of foundations) lines.push(renderAct(a));
    }
  }

  if (consistencyPct !== null) lines.push(`Consistency (last ${lastN}d): ${consistencyPct}% (${done}/${occ.length} showed up)`);

  // Observe-phase food log (pure repo+summarize path — no LLM in the dossier graph). One line,
  // only when something is logged; days_logged doubles as the module's phase signal for the coach.
  const foodLine = renderNutritionLine(summarizeNutrition(await listNutritionLogs(userId, from, to), lastN));
  if (foodLine) lines.push(foodLine);

  return lines.join('\n');
}
