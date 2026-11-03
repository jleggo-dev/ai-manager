/**
 * Answers kept for a client that comes back — how a long request survives the phone being left
 * (owner, 2026-11-03: "if a food lookup is in flight and I switch apps or lock the screen, the
 * lookup stops").
 *
 * iOS suspends the webview the moment the app leaves the screen. A request in flight at that
 * moment comes back to a socket that errors or never settles, and the client had no other way to
 * get the answer the server went on working out. A described-meal read can legitimately take
 * 10–150 s (two model calls, every source, and up to a minute on the web for a maker-named food),
 * which is plenty of time to switch apps or lock the phone.
 *
 * So a long request carries a client-made request id (a uuid the client mints and remembers),
 * and the route answers it through `runKept`:
 *
 *   1. CLAIM the id as `running` before the work starts (repos/kept-answers.ts). The first
 *      claim wins; a second request under the same id — the client re-sending because it could
 *      not tell whether the first one arrived — does not start a second read, it is answered
 *      from the row (202 while running, the answer once done, the fault once failed).
 *   2. RUN the work. The invocation runs whether or not the client is still listening (measured
 *      on the deployed API, scripts/probe-backgrounded-phone.ts: a coach reply generated in full
 *      after the client was killed 2.5 s in; scripts/probe-kept-answer.ts is this route's own).
 *   3. KEEP the outcome on the row — the answer, or the fault with the status the route would
 *      have answered with — BEFORE answering the live client. A write after the response is
 *      what Vercel freezes (services/background.ts); a write before it is the fix.
 *
 * The client that lost its connection asks GET /answers/:request_id (routes/answers.ts):
 *   - `done` → the answer, as the route would have sent it;
 *   - `failed` → the fault, so a refusal (a 400 for words the read could not take) is told the
 *     same way whether or not the connection survived;
 *   - `running` → still working, keep waiting (the row is younger than RUNNING_MAX_MS);
 *   - `lost` → the run was claimed and never finished (the instance died): a fault the client
 *     reports as ours, with a way to try again — never shown as "nothing found";
 *   - `unknown` → the server never got the request: the client re-sends it under the same id.
 *
 * Keeping the row is never allowed to cost the read: a claim or a write that fails is logged
 * and the live client still gets its answer the ordinary way. The client that left would then
 * find `unknown` and re-send, which is one wasted read, not a lost meal.
 */
import {
  claimKeptAnswer,
  finishKeptAnswer,
  readKeptAnswer,
  sweepKeptAnswers,
  type KeptAnswerRow,
  type KeptFault,
} from '../repos/kept-answers.ts';
import { runInBackground } from './background.ts';

export type { KeptFault } from '../repos/kept-answers.ts';

/** The long requests that keep their answers. Bare words, one per route, never shown to anyone. */
export const KEPT_ANSWER_KINDS = ['meal_preview', 'meal_answer', 'photo_read', 'photo_preview'] as const;
export type KeptAnswerKind = (typeof KEPT_ANSWER_KINDS)[number];

/**
 * Past this, a `running` row is a run that died with its instance, not a slow read. The client's
 * own bound on a read is 150 s (lib/api/nutrition.ts READ_TIMEOUT_MS), and the Vercel function
 * cap is further out still; five minutes leaves room for both and no room for a corpse to read
 * as "still working" tomorrow.
 */
export const RUNNING_MAX_MS = 5 * 60_000;

/** How long a finished row is kept. A client comes back within minutes; a day is generous. */
export const KEEP_FOR_MS = 24 * 60 * 60_000;

export type KeptAnswerStatus =
  | { status: 'unknown' }
  | { status: 'running'; started_at: string }
  | { status: 'done'; answer: unknown }
  | { status: 'failed'; fault: KeptFault }
  | { status: 'lost' };

/** What a row means to the client asking after it, by its state and age. */
export function statusOf(row: KeptAnswerRow | null, now = Date.now()): KeptAnswerStatus {
  if (!row) return { status: 'unknown' };
  if (row.status === 'done') return { status: 'done', answer: row.answer };
  if (row.status === 'failed') {
    return { status: 'failed', fault: row.fault ?? { status: 500, error: 'that request failed' } };
  }
  const startedMs = new Date(row.started_at).getTime();
  if (!Number.isFinite(startedMs) || now - startedMs > RUNNING_MAX_MS) return { status: 'lost' };
  return { status: 'running', started_at: new Date(startedMs).toISOString() };
}

export async function readAnswerStatus(userId: string, requestId: string): Promise<KeptAnswerStatus> {
  return statusOf(await readKeptAnswer(userId, requestId));
}

export type KeptRun<T> = { owner: true; answer: T } | { owner: false; status: KeptAnswerStatus };

/**
 * Run `work` as the owner of `requestId`, with its outcome kept on the row before this returns.
 * Resolves `{owner: true, answer}` or throws the work's own error (after the fault is kept), so
 * the route answers the live client exactly as it always did. Resolves `{owner: false, status}`
 * when another run already holds the id, for the route to answer from the row.
 */
export async function runKept<T>(
  userId: string,
  requestId: string,
  kind: KeptAnswerKind,
  work: () => Promise<T>,
  faultOf: (err: unknown) => KeptFault,
): Promise<KeptRun<T>> {
  let kept = true;
  try {
    const owner = await claimKeptAnswer(userId, requestId, kind, RUNNING_MAX_MS);
    if (!owner) return { owner: false, status: await readAnswerStatus(userId, requestId) };
    runInBackground('kept-answers-sweep', sweepKeptAnswers(userId, KEEP_FOR_MS));
  } catch (err) {
    // The row is a bonus for a client that left; the one still here gets its answer regardless.
    console.error('[kept-answers claim]', err);
    kept = false;
  }
  const keep = (outcome: { answer: unknown } | { fault: KeptFault }) =>
    kept
      ? finishKeptAnswer(userId, requestId, outcome).catch((e) => console.error('[kept-answers keep]', e))
      : undefined;
  try {
    const answer = await work();
    await keep({ answer });
    return { owner: true, answer };
  } catch (err) {
    await keep({ fault: faultOf(err) });
    throw err;
  }
}
