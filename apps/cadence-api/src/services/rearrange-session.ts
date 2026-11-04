/**
 * The coach rearranges ONE session in place (walkthrough v3 Phase 6, R2's agentic path — owner
 * 2026-11-03: "alternate the presses and rows, spread the hangs out", said in chat). A small AI
 * Admin job (`rearrange-session`, config/ai-admin/ai-admin.config.json): one stored session and
 * the person's words in, the SAME items in a new block structure out. Never `reviseSession`,
 * which rebuilds the whole session from scratch (~34 s) and would change the work itself.
 *
 * The job decides only WHERE a move sits and how its sets are split. Every item's fields are
 * carried from the original by name (`carryItems`, @cadence/shared), the item set is checked
 * (`sameItems`) and a changed set — a move added, dropped or renamed — is a fault, never written.
 * The checker runs on the result and its findings travel back as facts. What changed is said in
 * the Recap's own fixed words (`structureDiff` over `shapeOfRearranged`), so the coach reports
 * facts and the person hears the same words on their screen.
 */
import {
  type OccurrenceSession,
  type SessionFinding,
  type StructureChange,
  carryItems,
  checkSession,
  deriveWalkthrough,
  shapeOfRearranged,
  structureDiff,
} from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { getOccurrenceWithActivity, type OccurrenceWithActivity } from '../repos/occurrences.ts';
import { replaceOccurrenceSession } from '../repos/occurrence-sessions.ts';
import { getUser } from '../repos/users.ts';
import { localDayIso } from './plan-day.ts';
import { logAi } from './ai-log.ts';
import { normalizeSession } from './session-normalize.ts';

/** The whole call must answer inside this — a structure, not a prescription. */
export const REARRANGE_BUDGET_MS = 40_000;

export type RearrangeSessionResult =
  | {
      status: 'rearranged';
      occ: OccurrenceWithActivity;
      session: OccurrenceSession;
      changes: StructureChange[];
      findings: SessionFinding[];
    }
  | { status: 'not_found' }
  | {
      status: 'not_revisable';
      reason: 'system_row' | 'not_pending' | 'past' | 'no_session';
      occ: OccurrenceWithActivity;
    }
  /** The coach's answer changed the moves themselves — a move added, dropped or renamed. Nothing written. */
  | { status: 'items_changed'; occ: OccurrenceWithActivity }
  /** The answer could not be read as a session, the budget ran out, or the call failed. Nothing written. */
  | { status: 'failed'; occ: OccurrenceWithActivity; error: string };

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function withinBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no answer inside ${ms} ms`)), ms);
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

export async function rearrangeSession(
  userId: string,
  occurrenceId: string,
  words: string,
  budgetMs = REARRANGE_BUDGET_MS,
): Promise<RearrangeSessionResult> {
  const [occ, user] = await Promise.all([
    getOccurrenceWithActivity(userId, occurrenceId),
    getUser(userId).catch(() => null),
  ]);
  if (!occ) return { status: 'not_found' };
  if (occ.kind !== 'user') return { status: 'not_revisable', reason: 'system_row', occ };
  if (occ.status !== 'pending') return { status: 'not_revisable', reason: 'not_pending', occ };
  if (occ.date < localDayIso(new Date(), user?.timezone)) return { status: 'not_revisable', reason: 'past', occ };
  const before = occ.session;
  if (!before) return { status: 'not_revisable', reason: 'no_session', occ };

  const started = Date.now();
  let result: RearrangeSessionResult;
  let answered: OccurrenceSession | null = null;
  try {
    const res = await withinBudget(
      runJobBySlug(userId, 'rearrange-session', {
        activity: occ.title,
        session: JSON.stringify({ blocks: before.blocks, note: before.note }),
        words: words.trim(),
      }),
      budgetMs,
    );
    answered = normalizeSession(parseJson(res.formatted ?? res.raw ?? ''));
    if (!answered) result = { status: 'failed', occ, error: 'the answer could not be read as a session' };
    else {
      const carried = carryItems(before, answered);
      if (!carried) result = { status: 'items_changed', occ };
      else {
        const written = await replaceOccurrenceSession(userId, occurrenceId, carried);
        if (!written) {
          const now = await getOccurrenceWithActivity(userId, occurrenceId);
          result = !now ? { status: 'not_found' } : { status: 'not_revisable', reason: 'not_pending', occ: now };
        } else {
          const shape = shapeOfRearranged(before, carried);
          const changes = shape ? structureDiff(deriveWalkthrough(before).steps, shape) : [];
          result = {
            status: 'rearranged',
            occ: { ...occ, session: carried },
            session: carried,
            changes,
            findings: checkSession(carried),
          };
        }
      }
    }
  } catch (e) {
    result = { status: 'failed', occ, error: e instanceof Error ? e.message : String(e) };
  }

  void logAi(userId, {
    kind: 'rearrange_session',
    input: { occurrenceId, title: occ.title, date: occ.date, words },
    output: result.status === 'rearranged' ? result.session : answered,
    meta: {
      status: result.status,
      ms: Date.now() - started,
      ...(result.status === 'rearranged'
        ? { changes: result.changes.map((c) => c.words), findings: result.findings.length }
        : {}),
      ...(result.status === 'failed' ? { error: result.error } : {}),
    },
  });
  return result;
}
