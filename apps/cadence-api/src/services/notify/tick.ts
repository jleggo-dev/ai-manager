/**
 * The scheduler tick — the thing that lets Cadence act without a user present, which PLAN.md
 * names as the actual blocker for reminders and proactive check-ins.
 *
 * Shape: a tick asks each PRODUCER "who is due right now?", then hands every candidate to
 * `notify()`. Producers only decide *what* is due; they never decide whether it may be sent —
 * quiet hours, the daily cap, muting and dedupe all live in the dispatcher, so a new
 * notification type cannot accidentally ship without them.
 *
 * The registry is EMPTY on purpose. This is the framework landing before any notification
 * content is designed; a tick today does nothing but prove the path works end to end. Adding a
 * type is one entry here plus a function that returns candidates.
 */
import { notify, type NotifyRequest, type NotifyStatus } from './dispatch.ts';

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
 * No producers yet — see the module note. Deliberately not seeded with a placeholder: an
 * "example" producer that nobody wired is how a test notification reaches a real phone.
 */
export const PRODUCERS: RegisteredProducer[] = [];

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
