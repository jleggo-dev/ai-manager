/**
 * The Sunday sweep (S3) — the pending rail around the deterministic detection.
 *
 * Mirrors assessIfDue's shape: a weekly throttle on users.last_food_sweep_at, a skip while an
 * unanswered ask is outstanding, deterministic detection as the only gate on the model call, and
 * a pending-jsonb write the user resolves with ONE commit or a dismiss. The model
 * (`sweep-food-recipes`) only names from the user's own words, drops sets not worth a row, and
 * spots yield — every number in a proposal comes from the candidate, never from the model.
 *
 * The sweep never saves without asking, never proposes more than three, never proposes a set seen
 * once, never changes a logged number, and never regroups the past on its own — the tests in
 * food-sweep.test.ts pin each of those.
 */
import type { FoodSweepProposal, PendingFoodSweep, Recipe } from '@cadence/shared';
import { getUser, getPendingFoodSweep, setPendingFoodSweep, stampFoodSweep } from '../repos/users.ts';
import { insertRecipe } from '../repos/recipes.ts';
import { runJobBySlug } from '../ai/aim.ts';
import { runInBackground } from './background.ts';
import { detectSweepCandidates, type SweepCandidate } from './food-sweep-detect.ts';

const SWEEP_INTERVAL_DAYS = 7;
/** Never more than three proposals — the rail's own rule, enforced here regardless of the model. */
const MAX_PROPOSALS = 3;

/**
 * What actually lives in users.pending_food_sweep: the shared PendingFoodSweep, plus — after a
 * commit — the residue the retro tidy (S4) needs to find its targets. The tidy call arrives on a
 * SEPARATE request after commit, so "which logs, which new recipe" must survive the commit; it
 * rides the same jsonb under an extra key. Live proposals and residue never coexist: a commit
 * empties `proposals` as it writes `tidy_ready`, readFoodSweep reports null once proposals are
 * empty, and sweepIfDue only defers to a sweep that still has live proposals.
 */
export interface StoredFoodSweep extends PendingFoodSweep {
  tidy_ready?: TidyReadyEntry[];
}

export interface TidyReadyEntry {
  proposal_id: string;
  recipe_id: string;
  name: string;
  yield_servings: number;
  member_food_ids: string[];
  tidy_log_ids: string[];
}

/** The candidate fields the model needs — no ids of things it must not touch (logs, foods). */
function modelView(c: SweepCandidate): Record<string, unknown> {
  return {
    candidate_id: c.candidate_id,
    slot: c.slot,
    seen_count: c.seen_count,
    identical_meal_days: c.identical_meal_days,
    members: c.members.map((m) => ({
      name: m.name,
      ...(m.qty !== undefined ? { qty: m.qty } : {}),
      ...(m.unit !== undefined ? { unit: m.unit } : {}),
    })),
    raw_fragments: c.raw_fragments,
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const out: unknown = JSON.parse(text);
    return out && typeof out === 'object' ? (out as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Marry the model's judgements back onto the deterministic candidates. Null means the output was
 * structurally unusable (not JSON, no proposals array) — the caller logs and walks away; the
 * throttle is already stamped, so a bad model day costs nothing but a quiet week. Individually
 * malformed entries are dropped, kept ones are capped at MAX_PROPOSALS in candidate order
 * (candidates arrive most-seen first).
 */
function buildProposals(candidates: SweepCandidate[], out: Record<string, unknown> | null): FoodSweepProposal[] | null {
  if (!out || !Array.isArray(out.proposals)) return null;
  const byId = new Map(candidates.map((c) => [c.candidate_id, c]));
  const kept = new Map<string, { name: string; yield_servings: number; line: string }>();
  for (const raw of out.proposals) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const candidate = typeof p.candidate_id === 'string' ? byId.get(p.candidate_id) : undefined;
    if (!candidate || p.keep !== true) continue;
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 60) : '';
    if (!name) continue; // a proposal with no name from the user's words is not a proposal
    const yieldRaw = typeof p.yield_servings === 'number' ? Math.round(p.yield_servings) : 1;
    const line =
      typeof p.line === 'string' && p.line.trim()
        ? p.line.trim().slice(0, 200)
        : `Seen together on ${candidate.seen_count} days.`;
    kept.set(candidate.candidate_id, { name, yield_servings: Math.min(99, Math.max(1, yieldRaw)), line });
  }
  const proposals: FoodSweepProposal[] = [];
  for (const c of candidates) {
    const judged = kept.get(c.candidate_id);
    if (!judged) continue;
    proposals.push({
      id: c.candidate_id,
      yield_servings: judged.yield_servings,
      name: judged.name,
      members: c.members,
      seen_count: c.seen_count,
      slot: c.slot,
      line: judged.line,
      macros_per_serving: c.macros_per_serving,
      tidy_log_ids: c.tidy_log_ids,
    });
    if (proposals.length >= MAX_PROPOSALS) break;
  }
  return proposals;
}

/**
 * The weekly sweep, ridden along GET /nutrition/day. Throttled, skipped while an ask is
 * outstanding, and quiet in every failure mode — a broken sweep must never break the day read.
 */
export async function sweepIfDue(userId: string): Promise<void> {
  const user = await getUser(userId);
  if (!user) return;
  const pending = user.pending_food_sweep as StoredFoodSweep | null | undefined;
  if (pending?.proposals?.length) return; // an unanswered ask is outstanding — wait for the user

  const last = user.last_food_sweep_at ? new Date(user.last_food_sweep_at).getTime() : 0;
  if (Date.now() - last < SWEEP_INTERVAL_DAYS * 86_400_000) return;

  const candidates = await detectSweepCandidates(userId);
  await stampFoodSweep(userId); // the gate advances whether or not anything is proposed
  if (candidates.length === 0) return;

  const res = await runJobBySlug(userId, 'sweep-food-recipes', {
    candidates: JSON.stringify(candidates.map(modelView)),
  });
  const proposals = buildProposals(candidates, parseJson(res.formatted ?? res.raw ?? ''));
  if (!proposals) {
    console.warn(`[food-sweep] unusable sweep-food-recipes output for ${userId} — skipping this week`);
    return;
  }
  if (proposals.length === 0) return; // the model judged nothing worth a row — a fine answer
  await setPendingFoodSweep(userId, { built_at: new Date().toISOString(), proposals });
}

/** Fire-and-forget hook for the day read — the one line routes/nutrition.ts adds. */
export function kickFoodSweep(userId: string): void {
  runInBackground('foodSweepIfDue', sweepIfDue(userId));
}

/** What the client sees: the sweep while its ask is live, null once answered (or never asked). */
export async function readFoodSweep(userId: string): Promise<PendingFoodSweep | null> {
  const stored = (await getPendingFoodSweep(userId)) as StoredFoodSweep | null;
  if (!stored?.proposals?.length) return null;
  return { built_at: stored.built_at, proposals: stored.proposals };
}

/**
 * The ONE commit for the toggled subset. Each accepted proposal becomes a saved cookbook recipe;
 * declined ones are simply not saved. Live proposals clear either way (the ask is answered), and
 * the tidy residue is written so the follow-up "re-read the week behind you?" offer can act.
 */
export async function commitSweep(
  userId: string,
  acceptIds: string[],
): Promise<{ saved: Recipe[]; tidy: { proposal_id: string; log_count: number }[] }> {
  const stored = (await getPendingFoodSweep(userId)) as StoredFoodSweep | null;
  const live = stored?.proposals ?? [];
  const accepted = live.filter((p) => acceptIds.includes(p.id));
  if (!stored || live.length === 0) return { saved: [], tidy: [] };
  if (accepted.length === 0) {
    await setPendingFoodSweep(userId, null); // everything declined is still an answer
    return { saved: [], tidy: [] };
  }
  const saved: Recipe[] = [];
  const tidyReady: TidyReadyEntry[] = [];
  for (const p of accepted) {
    const recipe = await insertRecipe(userId, {
      name: p.name,
      source: 'ai',
      servings: Math.max(1, Math.round(p.yield_servings || 1)),
      ingredients: p.members.map((m) => ({
        food_id: m.food_id,
        name: m.name,
        qty: m.qty ?? 1,
        ...(m.unit !== undefined ? { unit: m.unit } : {}),
      })),
      macros_per_serving: p.macros_per_serving,
      saved: true,
    });
    saved.push(recipe);
    tidyReady.push({
      proposal_id: p.id,
      recipe_id: recipe.recipe_id,
      name: p.name,
      yield_servings: recipe.servings,
      member_food_ids: p.members.map((m) => m.food_id),
      tidy_log_ids: p.tidy_log_ids,
    });
  }
  const residue: StoredFoodSweep = { built_at: stored.built_at, proposals: [], tidy_ready: tidyReady };
  await setPendingFoodSweep(userId, residue);
  return { saved, tidy: tidyReady.map((t) => ({ proposal_id: t.proposal_id, log_count: t.tidy_log_ids.length })) };
}

/** "Not now" — the ask clears and the throttle re-stamps, so the next look is a week out. */
export async function dismissSweep(userId: string): Promise<void> {
  await setPendingFoodSweep(userId, null);
  await stampFoodSweep(userId);
}
