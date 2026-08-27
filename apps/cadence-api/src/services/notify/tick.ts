/**
 * The scheduler tick — the thing that lets Cadence act without a user present, which PLAN.md
 * names as the actual blocker for reminders and proactive check-ins.
 *
 * Shape: a tick asks each PRODUCER "who is due right now?", then hands every candidate to
 * `notify()`. Producers only decide *what* is due; they never decide whether it may be sent —
 * quiet hours, the daily cap, muting and dedupe all live in the dispatcher, so a new
 * notification type cannot accidentally ship without them.
 *
 * The registry holds the five PUSH nudges — the ones only the server can know about. The other
 * four in the catalog are LOCAL: the device schedules them from the committed plan, so they need
 * no tick, no APNs and no network. Adding a type is one entry in `producers/index.ts` plus a
 * function that returns candidates.
 */
import { notify, type NotifyRequest, type NotifyStatus } from './dispatch.ts';
import { PUSH_PRODUCERS } from './producers/index.ts';

/**
 * Returns everything due at `now`, across all users. A producer must be cheap and side-effect
 * free — it runs on every tick, and returning a candidate is not the same as sending one.
 */
export type Producer = (now: Date) => Promise<NotifyRequest[]>;

export interface RegisteredProducer {
  kind: string;
  produce: Producer;
}

/**
 * The live registry — the five PUSH nudges. Order is the tie-break when several become due on the
 * same day and only one fits under the cap; see `producers/index.ts` for why it is this order.
 *
 * The producers type-import `RegisteredProducer` from here, which is erased at build time, so this
 * import is one-directional at runtime despite reading like a cycle.
 */
export const PRODUCERS: RegisteredProducer[] = PUSH_PRODUCERS;

export interface TickResult {
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  duplicate: number;
  /** Per-kind breakdown, so a misbehaving type is identifiable from the cron log alone. */
  byKind: Record<string, Partial<Record<NotifyStatus, number>>>;
  errors: string[];
}

/**
 * Run one tick. Never throws: a scheduler that dies on one bad producer stops delivering for
 * everyone, and the caller is a cron with no one watching. Failures are counted and returned.
 */
export async function runTick(
  now: Date = new Date(),
  producers: RegisteredProducer[] = PRODUCERS,
): Promise<TickResult> {
  const result: TickResult = { candidates: 0, sent: 0, skipped: 0, failed: 0, duplicate: 0, byKind: {}, errors: [] };

  for (const { kind, produce } of producers) {
    let candidates: NotifyRequest[] = [];
    try {
      candidates = await produce(now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`producer ${kind}: ${message}`);
      console.error('[tick] producer failed', kind, message);
      continue; // one broken producer must not silence the others
    }

    result.candidates += candidates.length;
    for (const req of candidates) {
      const outcome = await notify(req, now);
      result[outcome.status] += 1;
      const bucket = (result.byKind[req.kind] ??= {});
      bucket[outcome.status] = (bucket[outcome.status] ?? 0) + 1;
    }
  }
  return result;
}
