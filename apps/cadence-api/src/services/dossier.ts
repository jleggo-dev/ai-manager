import { getUser } from '../repos/users.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listOccurrences } from '../repos/occurrences.ts';

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
    lines.push(`Current plan v${plan.version} (${activities.length} activities):`);
    for (const a of activities) lines.push(`  - [${a.kind}] ${a.title} — ${a.schedule?.recurrence ?? ''}`);
  }

  if (consistencyPct !== null) lines.push(`Consistency (last ${lastN}d): ${consistencyPct}% (${done}/${occ.length} showed up)`);

  return lines.join('\n');
}
