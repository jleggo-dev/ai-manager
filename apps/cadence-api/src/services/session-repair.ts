/**
 * The repair loop around a prescribed session (walkthrough v3, Phase 3b; owner ruling R4,
 * 2026-11-03). After the coach writes a session, the app checks it (`checkSession`, in
 * @cadence/shared) and, when the check finds something, asks her again with the findings as
 * facts in `<check_findings>`. She decides what to change; the app never rewrites her session.
 *
 * R4 makes it a bounded loop, built the way a harness builds one, not a single round as a
 * principle: each round must shrink the findings; it stops when the session is clean, when the
 * findings stop shrinking, or at the cap — a tuning number, never unbounded. On every stop the
 * session ships as it is and the findings are logged (the caller writes them through `logAi`), so
 * nobody gets stuck on a session the coach cannot make clean.
 *
 * What ships is the session with the FEWEST findings seen, the latest on a tie: a round that made
 * things worse never replaces the one before it, and a round that merely held still is still the
 * one she had the chance to fix. A round whose call fails, or whose answer does not survive the
 * normalizer, keeps the last good session — a repair must never lose what was already usable.
 *
 * Pure of the database and the job runner: the caller hands in the first session and a function
 * that runs one more round, so the loop's every branch is table-tested with a fake job.
 */
import type { OccurrenceSession, SessionFinding } from '@cadence/shared';
import { checkSession } from '@cadence/shared';

/** How many repair rounds may run after the first generation. A tuning number; R4 says start at 3. */
export const REPAIR_ROUNDS_MAX = 3;

export type RepairStop =
  /** The last round's session had no findings. */
  | 'clean'
  /** A round did not reduce the number of findings. */
  | 'not_shrinking'
  /** The cap on rounds was reached with findings still open. */
  | 'cap'
  /** A round's answer did not survive normalization; the session before it ships. */
  | 'unusable'
  /** A round's job call failed; the session before it ships. */
  | 'job_failed';

export interface RepairRound {
  /** 1 is the first generation; every repair call adds one. */
  round: number;
  findings: SessionFinding[];
}

export interface RepairResult {
  session: OccurrenceSession;
  /** Every round's findings, the first generation included, in order. */
  rounds: RepairRound[];
  stop: RepairStop;
  /** The failing call's message when `stop` is `job_failed`. */
  error?: string;
}

/** The outcome of a repair, flattened for the ai_log meta so the audit can count stops and rounds. */
export function repairLogMeta(r: RepairResult): {
  stop: RepairStop;
  rounds: Array<{ round: number; findings: SessionFinding[] }>;
  first: number;
  last: number;
  error?: string;
} {
  return {
    stop: r.stop,
    rounds: r.rounds,
    first: r.rounds[0]?.findings.length ?? 0,
    last: r.rounds[r.rounds.length - 1]?.findings.length ?? 0,
    ...(r.error ? { error: r.error } : {}),
  };
}

/**
 * Run the loop. `again` is one more round: it is handed the previous round's findings and comes
 * back with the coach's next normalized session, or null when her answer was unusable, or throws
 * when the call failed. `cap` is the number of `again` calls allowed.
 */
export async function repairSession(
  first: OccurrenceSession,
  again: (findings: SessionFinding[]) => Promise<OccurrenceSession | null>,
  cap = REPAIR_ROUNDS_MAX,
): Promise<RepairResult> {
  const rounds: RepairRound[] = [{ round: 1, findings: checkSession(first) }];
  let best = { session: first, count: rounds[0]!.findings.length };
  let previous = rounds[0]!.findings;

  if (previous.length === 0) return { session: first, rounds, stop: 'clean' };

  for (let call = 1; call <= cap; call += 1) {
    let next: OccurrenceSession | null;
    try {
      next = await again(previous);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { session: best.session, rounds, stop: 'job_failed', error: message };
    }
    if (!next) return { session: best.session, rounds, stop: 'unusable' };

    const findings = checkSession(next);
    rounds.push({ round: call + 1, findings });
    // The fewest findings seen ships; on a tie the latest, which had the chance to fix them.
    if (findings.length <= best.count) best = { session: next, count: findings.length };

    if (findings.length === 0) return { session: next, rounds, stop: 'clean' };
    if (call === cap) return { session: best.session, rounds, stop: 'cap' };
    if (findings.length >= previous.length) return { session: best.session, rounds, stop: 'not_shrinking' };
    previous = findings;
  }
  // Unreachable: the loop returns on its last call. Kept so the function has one shape.
  return { session: best.session, rounds, stop: 'cap' };
}
