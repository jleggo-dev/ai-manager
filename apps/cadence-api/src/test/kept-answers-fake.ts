/**
 * An in-memory stand-in for repos/kept-answers.ts — the same four functions over a Map, for tests
 * that drive routes/answers.ts (`vi.mock('../repos/kept-answers.ts', () => import('../test/kept-answers-fake.ts'))`).
 * Stamps rows with the real clock, like the table does; `backdateKeptAnswer` ages one so a test can
 * see what a run that died looks like to the client asking after it.
 */
import type { KeptAnswerRow, KeptFault } from '../repos/kept-answers.ts';

export interface FakeKeptRow extends KeptAnswerRow {
  user_id: string;
  started_at: Date;
}

export const rows = new Map<string, FakeKeptRow>();
const key = (userId: string, requestId: string) => `${userId}:${requestId}`;

export function resetKeptAnswers(): void {
  rows.clear();
}

/** Age a running row by `ms`, as if it had been claimed that long ago. */
export function backdateKeptAnswer(userId: string, requestId: string, ms: number): void {
  const row = rows.get(key(userId, requestId));
  if (row) row.started_at = new Date(row.started_at.getTime() - ms);
}

export async function claimKeptAnswer(
  userId: string,
  requestId: string,
  kind: string,
  staleAfterMs: number,
): Promise<boolean> {
  const row = rows.get(key(userId, requestId));
  const fresh = { status: 'running' as const, answer: null, fault: null, started_at: new Date(), finished_at: null };
  if (!row) {
    rows.set(key(userId, requestId), { user_id: userId, request_id: requestId, kind, ...fresh });
    return true;
  }
  if (row.status === 'running' && Date.now() - row.started_at.getTime() > staleAfterMs) {
    Object.assign(row, fresh);
    return true;
  }
  return false;
}

export async function finishKeptAnswer(
  userId: string,
  requestId: string,
  outcome: { answer: unknown } | { fault: KeptFault },
): Promise<void> {
  const row = rows.get(key(userId, requestId));
  if (!row) return;
  if ('answer' in outcome) Object.assign(row, { status: 'done', answer: outcome.answer, fault: null });
  else Object.assign(row, { status: 'failed', answer: null, fault: outcome.fault });
  row.finished_at = new Date();
}

export async function readKeptAnswer(userId: string, requestId: string): Promise<KeptAnswerRow | null> {
  return rows.get(key(userId, requestId)) ?? null;
}

export async function sweepKeptAnswers(): Promise<void> {}
