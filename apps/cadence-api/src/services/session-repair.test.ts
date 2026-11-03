/**
 * The repair loop (R4) with a fake job: every branch of the loop, named by the shape of its
 * findings across rounds. "3→1→0" means the first generation had three findings, the first repair
 * one, the second none.
 */
import { describe, expect, it, vi } from 'vitest';
import type { OccurrenceSession, SessionFinding, SessionItem } from '@cadence/shared';
import { REPAIR_ROUNDS_MAX, repairLogMeta, repairSession } from './session-repair.ts';

/** A session with exactly `n` findings: `n` carries written as one rep in several sets. */
function withFindings(n: number, tag = 'x'): OccurrenceSession {
  const items: SessionItem[] = Array.from({ length: n }, (_, i) => ({
    name: `Carry ${tag}${i + 1}`,
    sets: 3,
    reps: 1,
  }));
  items.push({ name: `Press ${tag}`, sets: 3, reps: 8 });
  return { blocks: [{ label: 'Main', items }], note: tag, generated_at: '2026-11-03T00:00:00.000Z', version: 1 };
}

/** A fake job: each call returns the next session in the list (or throws / returns null). */
function fakeJob(answers: Array<OccurrenceSession | null | Error>) {
  const calls: SessionFinding[][] = [];
  const again = vi.fn(async (findings: SessionFinding[]) => {
    calls.push(findings);
    const a = answers[calls.length - 1];
    if (a instanceof Error) throw a;
    return a ?? null;
  });
  return { again, calls };
}

const counts = (r: { rounds: Array<{ findings: SessionFinding[] }> }) => r.rounds.map((x) => x.findings.length);

describe('repairSession — the bounded loop (R4)', () => {
  it('the cap starts at 3', () => {
    expect(REPAIR_ROUNDS_MAX).toBe(3);
  });

  it('clean on round 1: the job is never called again', async () => {
    const { again } = fakeJob([]);
    const r = await repairSession(withFindings(0), again);
    expect(r.stop).toBe('clean');
    expect(counts(r)).toEqual([0]);
    expect(again).not.toHaveBeenCalled();
  });

  it('3→1→0: shrinks to clean, and ships the clean session', async () => {
    const clean = withFindings(0, 'clean');
    const { again, calls } = fakeJob([withFindings(1, 'b'), clean]);
    const r = await repairSession(withFindings(3, 'a'), again);
    expect(r.stop).toBe('clean');
    expect(counts(r)).toEqual([3, 1, 0]);
    expect(r.session).toBe(clean);
    // Each round is handed the previous round's findings, as facts.
    expect(calls[0]).toHaveLength(3);
    expect(calls[0]?.[0]?.fact).toContain("'Carry a1'");
    expect(calls[1]).toHaveLength(1);
    expect(calls[1]?.[0]?.fact).toContain("'Carry b1'");
  });

  it('3→3: stops after round 2 because the findings did not shrink; the latest ships on a tie', async () => {
    const second = withFindings(3, 'b');
    const { again } = fakeJob([second, withFindings(0, 'never')]);
    const r = await repairSession(withFindings(3, 'a'), again);
    expect(r.stop).toBe('not_shrinking');
    expect(counts(r)).toEqual([3, 3]);
    expect(again).toHaveBeenCalledTimes(1);
    expect(r.session).toBe(second);
  });

  it('3→5: a round that made things worse never replaces the one before it', async () => {
    const first = withFindings(3, 'a');
    const { again } = fakeJob([withFindings(5, 'b')]);
    const r = await repairSession(first, again);
    expect(r.stop).toBe('not_shrinking');
    expect(counts(r)).toEqual([3, 5]);
    expect(r.session).toBe(first);
  });

  it('3→2→1→1: stops at the cap with the last session shipped', async () => {
    const last = withFindings(1, 'd');
    const { again } = fakeJob([withFindings(2, 'b'), withFindings(1, 'c'), last, withFindings(0, 'never')]);
    const r = await repairSession(withFindings(3, 'a'), again);
    expect(r.stop).toBe('cap');
    expect(counts(r)).toEqual([3, 2, 1, 1]);
    expect(again).toHaveBeenCalledTimes(3);
    expect(r.session).toBe(last);
  });

  it('4→3→2→1: still shrinking at the cap stops anyway — the cap is a cap', async () => {
    const third = withFindings(1, 'd');
    const { again } = fakeJob([withFindings(3, 'b'), withFindings(2, 'c'), third, withFindings(0, 'never')]);
    const r = await repairSession(withFindings(4, 'a'), again);
    expect(r.stop).toBe('cap');
    expect(counts(r)).toEqual([4, 3, 2, 1]);
    expect(r.session).toBe(third);
  });

  it('a smaller cap is honoured', async () => {
    const { again } = fakeJob([withFindings(2, 'b'), withFindings(1, 'c')]);
    const r = await repairSession(withFindings(3, 'a'), again, 1);
    expect(r.stop).toBe('cap');
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('a job failure mid-loop ships the previous round’s session and names the error', async () => {
    const second = withFindings(2, 'b');
    const { again } = fakeJob([second, new Error('AI Admin POST … → 503: down')]);
    const r = await repairSession(withFindings(3, 'a'), again);
    expect(r.stop).toBe('job_failed');
    expect(r.error).toContain('503');
    expect(counts(r)).toEqual([3, 2]);
    expect(r.session).toBe(second);
  });

  it('a job failure on the first repair ships the first generation', async () => {
    const first = withFindings(3, 'a');
    const { again } = fakeJob([new Error('boom')]);
    const r = await repairSession(first, again);
    expect(r.stop).toBe('job_failed');
    expect(r.session).toBe(first);
  });

  it('an unusable answer (normalizer returned null) ships the last good session', async () => {
    const second = withFindings(2, 'b');
    const { again } = fakeJob([second, null]);
    const r = await repairSession(withFindings(3, 'a'), again);
    expect(r.stop).toBe('unusable');
    expect(counts(r)).toEqual([3, 2]);
    expect(r.session).toBe(second);
  });

  it('the log meta carries the stop, every round, and the first and last counts', async () => {
    const { again } = fakeJob([withFindings(2, 'b'), new Error('down')]);
    const meta = repairLogMeta(await repairSession(withFindings(3, 'a'), again));
    expect(meta.stop).toBe('job_failed');
    expect(meta.first).toBe(3);
    expect(meta.last).toBe(2);
    expect(meta.error).toBe('down');
    expect(meta.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(meta.rounds[1]?.findings[0]?.rule).toBe('one_rep_sets');
  });
});
