import type { Constraint } from '@cadence/shared';
import { normTitle, sameGoalTitle } from './goal-identity.ts';

/**
 * Merging what the Broker just heard into what we already knew about someone's constraints.
 *
 * The bug this exists to kill: ambient capture went through `mergeBaseline`, which is a shallow
 * jsonb merge (`baseline || patch`), so the WHOLE constraints array was replaced by whatever the
 * current conversation happened to mention. The capture window is one session's history, so a
 * chat in week three that mentioned a bad shoulder silently deleted the knee, the night shifts
 * and the grief recorded in week one. Constraints are the safety input to every plan and sit in
 * the MANDATORY context pack, so losing one is not a cosmetic bug — it is the app forgetting the
 * thing it must never forget, and then planning around its own amnesia.
 *
 * Three rules:
 * 1. **Nothing is ever dropped by silence.** A constraint the user simply didn't mention today is
 *    still true today. Removal is an explicit act, and it belongs to Settings.
 * 2. **A returning constraint keeps its identity.** Matching reuses `sameGoalTitle` — the
 *    containment rule already hardened on the goal-duplication bug — so the same knee updates in
 *    place instead of arriving as a second knee with a new id every turn, AND a constraint
 *    restated with more detail ("burnout" → "burnout — signed off work") lands on the existing
 *    row rather than becoming a twin. That is the same failure that once tripled someone's goals,
 *    and it was one capture away from happening here.
 * 3. **The newest telling wins the details.** `plan_around`, `status` and `until` are re-stated
 *    facts, so the fresh capture overwrites them — that is how "my knee's fine now" (status
 *    `quiet`) actually lifts, and how a date-bounded constraint gets its date.
 *
 * Settings keeps using the wholesale path on purpose: when someone deletes a row there, they mean
 * it, and a merge that resurrected it would be its own kind of broken.
 */

/**
 * Is this the same thing they already told us about?
 *
 * `sameGoalTitle` first — it carries the hardening from the goal-duplication bug. But it requires
 * TWO words before it will call containment a match, deliberately, so that "Row" cannot swallow
 * "Grow strong". That guard is right for goal NAMES and wrong here: constraint labels are short
 * complaints that get refined as someone talks, and the single most common shape is exactly the
 * one it rejects — "knee" on Monday becoming "left knee — patellar tendinopathy" on Friday.
 *
 * So constraints additionally accept single-word containment, floored at four characters to keep
 * articles and scraps out. The asymmetry of costs justifies it: a false SPLIT accumulates
 * duplicate constraints forever (the bug being fixed), while a false MERGE keeps the fuller label
 * of two closely-worded complaints. Multi-word labels still need every word present, so "knee
 * pain" and "back pain" stay two things.
 */
function sameConstraint(a: string, b: string): boolean {
  if (sameGoalTitle(a, b)) return true;
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (shorter.length < 4) return false;
  const pool = new Set(longer.split(' '));
  return shorter.split(' ').every((w) => pool.has(w));
}

export function mergeConstraints(existing: Constraint[], incoming: Constraint[]): Constraint[] {
  const merged = existing.map((c) => ({ ...c }));

  for (const inc of incoming) {
    const label = inc.label?.trim() ?? '';
    if (!normTitle(label)) continue;
    // First match wins: if the stored list already carries duplicates, update the earliest rather
    // than inventing a third.
    const at = merged.findIndex((m) => sameConstraint(m.label ?? '', label));
    if (at === -1) {
      merged.push({ ...inc, label });
      continue;
    }
    const prev = merged[at]!;
    merged[at] = {
      ...prev,
      // The id is the one thing the fresh capture must NOT bring — it mints a new uuid every
      // turn, and anything holding a reference would watch the same constraint change identity.
      id: prev.id,
      // Keep the longer telling: "left knee — patellar tendinopathy" outlives "knee".
      label: inc.label.trim().length > (prev.label?.trim().length ?? 0) ? inc.label.trim() : prev.label,
      kind: inc.kind ?? prev.kind,
      plan_around: inc.plan_around,
      ...(inc.status ? { status: inc.status } : prev.status ? { status: prev.status } : {}),
      ...(inc.until ? { until: inc.until } : prev.until ? { until: prev.until } : {}),
    };
  }
  return merged;
}
