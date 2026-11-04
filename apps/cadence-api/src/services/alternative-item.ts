/**
 * "Something else" on the Change sheet (walkthrough v3 Phase 5f): the person is mid-session and
 * wants a move the coach did not list. ONE item goes to a small AI Admin job (`alternative-item`,
 * config/ai-admin/ai-admin.config.json) with the equipment, the constraints and the last few logs
 * for that item; ONE alternative comes back in the shape the session normalizer accepts
 * (session-alternatives.ts). Never `reviseSession`: that rebuilds the whole session in ~34 s, and
 * the sheet is open now.
 *
 * Bounded in time: the sheet shows "asking · ~20 s", so an answer that has not landed inside the
 * budget is a fault the sheet says in words, not a spinner. The job call itself is not cancelled —
 * the engine has no cancel — but its answer is dropped and still logged.
 */
import type { SessionItem, SessionItemAlternative } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getUser } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import { exerciseHistory } from './exercise-history.ts';
import { normalizeAlternative } from './session-alternatives.ts';

/** The whole call, lookups included, must answer inside this. */
export const ALTERNATIVE_BUDGET_MS = 25_000;

export type AlternativeItemResult =
  | { status: 'ok'; alternative: SessionItemAlternative }
  /** The coach answered, but with nothing the app can show (no name, unparseable). */
  | { status: 'unusable' }
  /** The budget ran out, or the call failed. */
  | { status: 'unreachable'; error: string };

export interface AlternativeItemAsk {
  /** The activity the session belongs to, for the coach's context. */
  activity?: string;
  /** The item as the session carries it — name and the quantities it has. */
  item: Pick<SessionItem, 'name' | 'sets' | 'reps' | 'load' | 'duration_min' | 'distance_km' | 'detail'>;
  /** Names already on the sheet (her build-time alternatives, earlier answers), so she gives another. */
  alreadyOffered?: string[];
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

class BudgetError extends Error {
  constructor(ms: number) {
    super(`no answer inside ${ms} ms`);
    this.name = 'BudgetError';
  }
}

function withinBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new BudgetError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export async function askAlternativeItem(
  userId: string,
  ask: AlternativeItemAsk,
  budgetMs = ALTERNATIVE_BUDGET_MS,
): Promise<AlternativeItemResult> {
  const started = Date.now();
  const run = async (): Promise<AlternativeItemResult> => {
    const [equipment, user, history] = await Promise.all([
      listEquipment(userId),
      getUser(userId),
      exerciseHistory(userId, { exercise: ask.item.name, activity: ask.activity, limit: 4 }),
    ]);
    const constraints = (user?.baseline?.constraints ?? []).map((c) => ({
      label: c.label,
      kind: c.kind,
      status: c.status,
      plan_around: c.plan_around,
    }));
    const res = await runJobBySlug(userId, 'alternative-item', {
      activity: ask.activity ?? '',
      item: JSON.stringify(ask.item),
      already_offered: JSON.stringify(ask.alreadyOffered ?? []),
      equipment: JSON.stringify(equipment.map((e) => ({ name: e.name, category: e.category }))),
      constraints: JSON.stringify(constraints),
      recent_logs: history.length
        ? history
            .map(
              (h) =>
                `- ${h.date}: ${[h.sets && `${h.sets} sets`, h.reps && `${h.reps} reps`, h.seconds && `${h.seconds} s`, h.load].filter(Boolean).join(', ')}`,
            )
            .join('\n')
        : '[]',
    });
    const parsed = parseJson(res.formatted ?? res.raw ?? '');
    const alternative = normalizeAlternative(parsed?.alternative);
    return alternative ? { status: 'ok', alternative } : { status: 'unusable' };
  };

  let result: AlternativeItemResult;
  try {
    result = await withinBudget(run(), budgetMs);
  } catch (e) {
    result = { status: 'unreachable', error: e instanceof Error ? e.message : String(e) };
  }
  void logAi(userId, {
    kind: 'alternative_item',
    input: { activity: ask.activity, item: ask.item.name, already_offered: ask.alreadyOffered ?? [] },
    output: result.status === 'ok' ? result.alternative : null,
    meta: {
      status: result.status,
      ms: Date.now() - started,
      ...(result.status === 'unreachable' ? { error: result.error } : {}),
    },
  });
  return result;
}
