import { json, sql } from '../db/sql.ts';

/**
 * The answers kept for a client that comes back (migration 0065). One row per long request,
 * keyed by the client's own request id. The rules — what counts as still running, when a row is
 * a lost run — live in services/kept-answers.ts; this file only reads and writes rows.
 */

export type KeptAnswerState = 'running' | 'done' | 'failed';

/** What the route would have answered with when it refused: the status and the body's line. */
export interface KeptFault {
  status: number;
  error: string;
}

export interface KeptAnswerRow {
  request_id: string;
  kind: string;
  status: KeptAnswerState;
  answer: unknown | null;
  fault: KeptFault | null;
  /** postgres.js hands timestamptz back as a Date; a test may hand a string. Read through new Date(). */
  started_at: Date | string;
  finished_at: Date | string | null;
}

/**
 * Take the request id as its run's owner: a fresh row, or a `running` row older than
 * `staleAfterMs` (a run that died with its instance — its new owner starts over). Returns false
 * when another run already holds the id and is fresh or finished; the caller then answers from
 * that row.
 */
export async function claimKeptAnswer(
  userId: string,
  requestId: string,
  kind: string,
  staleAfterMs: number,
): Promise<boolean> {
  const rows = await sql<{ request_id: string }[]>`
    insert into cadence.kept_answers (user_id, request_id, kind, status)
    values (${userId}, ${requestId}, ${kind}, 'running')
    on conflict (user_id, request_id) do update
      set status = 'running', answer = null, fault = null, started_at = now(), finished_at = null
      where cadence.kept_answers.status = 'running'
        and cadence.kept_answers.started_at < now() - make_interval(secs => ${staleAfterMs / 1000})
    returning request_id`;
  return rows.length > 0;
}

/** The answer, or the fault, written on the row — before the route answers the live client. */
export async function finishKeptAnswer(
  userId: string,
  requestId: string,
  outcome: { answer: unknown } | { fault: KeptFault },
): Promise<void> {
  if ('answer' in outcome) {
    await sql`
      update cadence.kept_answers
      set status = 'done', answer = ${json(outcome.answer)}, fault = null, finished_at = now()
      where user_id = ${userId} and request_id = ${requestId}`;
    return;
  }
  await sql`
    update cadence.kept_answers
    set status = 'failed', answer = null, fault = ${json(outcome.fault)}, finished_at = now()
    where user_id = ${userId} and request_id = ${requestId}`;
}

export async function readKeptAnswer(userId: string, requestId: string): Promise<KeptAnswerRow | null> {
  const [row] = await sql<KeptAnswerRow[]>`
    select request_id, kind, status, answer, fault, started_at, finished_at
    from cadence.kept_answers
    where user_id = ${userId} and request_id = ${requestId}`;
  return row ?? null;
}

/** Rows are scratch: this person's rows older than `olderThanMs` go. */
export async function sweepKeptAnswers(userId: string, olderThanMs: number): Promise<void> {
  await sql`
    delete from cadence.kept_answers
    where user_id = ${userId} and started_at < now() - make_interval(secs => ${olderThanMs / 1000})`;
}
