/**
 * `balance` — proportion of felt-states ("calmer after 6 of 8 sits"), docs/cadence/PROGRESS-ENGINE.md
 * W1-5. Binds to `session_feedback` in a window. Brand rule enforced here, not just documented:
 * this payload counts what happened and NEVER exposes the complement as a field the client could
 * chart as a red "negative" series — `BalancePayload` has no room for one and this resolver never
 * invents one.
 */
import type { BalancePayload, SessionFeedbackKind, WidgetOmission } from '@cadence/shared';
import { feedbackInRange, type SessionFeedbackRow } from '../repos/coach-moments.ts';
import { omit } from './progress-window.ts';

const NOUN: Record<SessionFeedbackKind, string> = { mind: 'sits', movement: 'sessions' };
const POSITIVE_LABEL: Record<SessionFeedbackKind, string> = { mind: 'Calmer', movement: 'Felt right' };

/** Pure: fold already-fetched feedback rows (any kind) into one kind's balance shape. */
export function resolveBalance(rows: SessionFeedbackRow[], kind: SessionFeedbackKind): BalancePayload | WidgetOmission {
  const slice = rows.filter((r) => r.kind === kind);
  if (slice.length === 0) return omit(`balance:${kind}`, 'balance', `no answered ${kind} sessions in this window`);
  const positive =
    kind === 'mind'
      ? slice.filter((r) => r.felt_state === 'calmer').length
      : slice.filter((r) => r.rpe === 'just_right').length;
  return { positive_label: POSITIVE_LABEL[kind], positive, total: slice.length, noun: NOUN[kind] };
}

/** Fetch + resolve for one user's window. */
export async function getBalance(
  userId: string,
  kind: SessionFeedbackKind,
  fromDate: string,
  toDate: string,
): Promise<BalancePayload | WidgetOmission> {
  const rows = await feedbackInRange(userId, fromDate, toDate);
  return resolveBalance(rows, kind);
}
