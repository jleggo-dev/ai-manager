/**
 * The transport retry around a prescribe-session call — the gap the 2026-10-27/28 outage named.
 *
 * When Devs.ai stopped serving the Coach profile's models, `prescribe-session` failed 414 times
 * in a day and every workout and piano session on the phone opened to "Couldn't open this just
 * now". Two things were missing: a second try before answering, and an honest answer when every
 * try fails. This module is the first; the route and the sheet carry the second.
 *
 * Scope is deliberately narrow:
 *   - Only TRANSIENT failures retry — a provider 5xx or 429, a timeout, a dropped socket, or AI
 *     Admin's "primary failed and failover also failed" line. Our own 4xx (a bad payload, a job
 *     that is not synced, a config fault) fails at once: retrying it would spend money on the same
 *     wrong call.
 *   - A small, bounded number of attempts with backoff, and a cap on how long the sheet may be
 *     left waiting for a retry to be worth scheduling. A model call that itself ran long is not
 *     retried past that cap — the person has been looking at typing dots for long enough.
 *   - It says what happened: one log line per failed attempt with its number, and a typed error
 *     the route can turn into a distinguishable 503 rather than the generic 500.
 *
 * The normalize-null re-roll in session-generate.ts stays separate: that one is about unusable
 * OUTPUT from a call that succeeded; this one is about the call not getting through at all.
 */
import { AimError } from '../ai/aim-errors.ts';

/** Every attempt failed on a transient fault — the route answers 503 `coach_unreachable`. */
export class CoachUnreachableError extends Error {
  readonly attempts: number;
  readonly cause: unknown;

  constructor(attempts: number, cause: unknown) {
    super(`coach unreachable after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${AimError.messageOf(cause)}`);
    this.name = 'CoachUnreachableError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

/** Numeric status carried on the error object, if any (fetch-style errors and AI Admin's own). */
function statusOf(err: unknown): number {
  if (typeof err !== 'object' || err === null) return NaN;
  const o = err as { status?: unknown; statusCode?: unknown };
  const s = o.status ?? o.statusCode;
  return s === undefined ? NaN : Number(s);
}

/**
 * Is this failure worth a second try? The decision table is pinned by session-generate-retry.test.ts.
 *
 * YES: AimError kind `upstream`; a 5xx or 429 on the error or in the message
 * ("AI Admin POST … → 503: …"); a timeout; a dropped connection; a rate limit; AI Admin's
 * "Primary model … failed and failover … also failed".
 * NO: AimError kind `config` or `not_found`; our own 4xx (400/401/403/404/422 — a bad payload or
 * an unsynced job); anything that names none of the above (an unknown fault is not a provider
 * blip until proven otherwise, and a retry would just double the cost of finding out).
 */
export function isTransientCoachFailure(err: unknown): boolean {
  const msg = AimError.messageOf(err);
  // First, because its tail quotes the provider's own words — "… also failed: 400 model not
  // found" — and the generic classifier would read that tail as a not-found of ours.
  if (/\bfailover\b.*\balso failed\b/i.test(msg)) return true;
  if (err instanceof AimError && (err.kind === 'config' || err.kind === 'not_found')) return false;
  const status = statusOf(err);
  if (Number.isFinite(status)) {
    if (status === 429 || status >= 500) return true;
    if (status >= 400) return false;
  }
  // AI Admin's remote path folds the HTTP status into the message: "… → 503: …".
  const inMessage = /(?:→|->|\bstatus\b|\bHTTP\b)\s*(\d{3})\b/i.exec(msg);
  if (inMessage) {
    const code = Number(inMessage[1]);
    if (code === 429 || code >= 500) return true;
    if (code >= 400) return false;
  }
  if (err instanceof AimError && err.kind === 'upstream') return true;
  if (/\btimed? ?out\b|\btimeout\b/i.test(msg)) return true;
  if (/rate.?limit|\btoo many requests\b|\boverloaded\b/i.test(msg)) return true;
  if (/\bfetch failed\b|\bECONNRESET\b|\bECONNREFUSED\b|\bsocket hang up\b|\bEAI_AGAIN\b/i.test(msg)) return true;
  return false;
}

export interface CoachRetryOptions {
  /** Total attempts, the first included. */
  attempts?: number;
  /** Wait before the second attempt; doubles each time after. */
  baseDelayMs?: number;
  /** No retry is scheduled once this much time has passed since the first attempt began. */
  maxElapsedMs?: number;
  /** Injection points for tests — real callers leave both out. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Named for the log line: "[prescribe-session] attempt 1/3 failed …". */
  label?: string;
}

export const COACH_RETRY_DEFAULTS = { attempts: 3, baseDelayMs: 1_500, maxElapsedMs: 20_000 } as const;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run `fn`, retrying a transient failure a bounded number of times with doubling backoff.
 *
 * Non-transient errors rethrow untouched on the first failure. When the attempts run out, or
 * the next wait would push past `maxElapsedMs`, the last transient error is wrapped in
 * `CoachUnreachableError` so the caller can say so to the person rather than shrug a 500.
 */
export async function withCoachRetry<T>(fn: () => Promise<T>, opts: CoachRetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? COACH_RETRY_DEFAULTS.attempts;
  const baseDelayMs = opts.baseDelayMs ?? COACH_RETRY_DEFAULTS.baseDelayMs;
  const maxElapsedMs = opts.maxElapsedMs ?? COACH_RETRY_DEFAULTS.maxElapsedMs;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const label = opts.label ?? 'coach call';
  const started = now();

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientCoachFailure(err)) throw err;
      const elapsed = now() - started;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      const outOfAttempts = attempt >= attempts;
      const outOfTime = elapsed + delay > maxElapsedMs;
      console.warn(
        `[${label}] attempt ${attempt}/${attempts} failed (transient, ${Math.round(elapsed / 1000)}s in): ${AimError.messageOf(err)}` +
          (outOfAttempts || outOfTime ? ' — giving up' : ` — retrying in ${delay}ms`),
      );
      if (outOfAttempts || outOfTime) throw new CoachUnreachableError(attempt, err);
      await sleep(delay);
    }
  }
}
