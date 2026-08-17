/**
 * A19 / migration 0036 — the commitment lineage that survives Apply.
 *
 * Every Apply supersedes the plan and inserts fresh activity rows, so before this the only thread
 * between versions was the TITLE. That string was quietly doing three jobs at once: addressing an
 * edit, joining a commitment's occurrences into one history, and dedup. Rename a commitment and
 * its history split in two, silently.
 *
 * `commitment_id` is the thread instead. These tests cover the seam where it can be lost — a
 * REBUILD, which synthesis writes from scratch with no lineage on it at all.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Activity } from '@cadence/shared';

vi.mock('../config.ts', () => ({
  cadenceConfig: {
    databaseUrl: 'postgresql://mock:mock@mock:5432/mock',
    supabase: { url: '', anonKey: '', serviceRoleKey: '' },
    aim: {},
  },
}));
vi.mock('../ai/aim.ts', () => ({ runJob: vi.fn(), runJobBySlug: vi.fn() }));

const { inheritCommitmentIds } = await import('./plan-synthesis.ts');

const prev = (title: string, commitment_id: string): Activity =>
  ({
    activity_id: `row-${commitment_id}`,
    commitment_id,
    plan_id: 'old',
    title,
    kind: 'user',
    schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU' },
    completion_source: 'self_report',
  }) as Activity;

describe('inheritCommitmentIds', () => {
  /** Without this, "build my week again" orphans the past of everything it KEPT. */
  it('gives a rebuilt commitment the lineage of the one it replaces', () => {
    const proposed: Partial<Activity>[] = [{ title: 'Long run' }, { title: 'Morning sit' }];
    inheritCommitmentIds(proposed, [prev('Long run', 'c-long'), prev('Morning sit', 'c-sit')]);
    expect(proposed.map((p) => p.commitment_id)).toEqual(['c-long', 'c-sit']);
  });

  it('leaves a genuinely new commitment without one, so the column mints a fresh lineage', () => {
    const proposed: Partial<Activity>[] = [{ title: 'Cold plunge' }];
    inheritCommitmentIds(proposed, [prev('Long run', 'c-long')]);
    expect(proposed[0]!.commitment_id).toBeUndefined();
  });

  /** Every propose_plan_change edit arrives already carrying its lineage. Do not second-guess it. */
  it('never overwrites a lineage the caller already supplied', () => {
    const proposed: Partial<Activity>[] = [{ title: 'Long run', commitment_id: 'c-explicit' }];
    inheritCommitmentIds(proposed, [prev('Long run', 'c-long')]);
    expect(proposed[0]!.commitment_id).toBe('c-explicit');
  });

  /**
   * The failure that would reintroduce the whole bug in a new column: two same-titled rows both
   * inheriting ONE lineage, and therefore becoming un-addressable again. Ids come from a per-title
   * queue, so each is handed out exactly once.
   */
  it('gives same-titled twins distinct lineages, never the same one twice', () => {
    const proposed: Partial<Activity>[] = [{ title: 'Easy run' }, { title: 'Easy run' }];
    inheritCommitmentIds(proposed, [prev('Easy run', 'c-a'), prev('Easy run', 'c-b')]);
    expect(proposed.map((p) => p.commitment_id)).toEqual(['c-a', 'c-b']);
    expect(new Set(proposed.map((p) => p.commitment_id)).size).toBe(2);
  });

  it('runs out of lineages gracefully when the rebuild adds a third of the same name', () => {
    const proposed: Partial<Activity>[] = [{ title: 'Easy run' }, { title: 'Easy run' }, { title: 'Easy run' }];
    inheritCommitmentIds(proposed, [prev('Easy run', 'c-a'), prev('Easy run', 'c-b')]);
    expect(proposed.map((p) => p.commitment_id)).toEqual(['c-a', 'c-b', undefined]);
  });

  it('matches on the title as written, ignoring case and stray spacing', () => {
    const proposed: Partial<Activity>[] = [{ title: '  LONG RUN ' }];
    inheritCommitmentIds(proposed, [prev('Long run', 'c-long')]);
    expect(proposed[0]!.commitment_id).toBe('c-long');
  });

  /** A rename is where history used to break in silence — and still does, by design: a renamed
   *  commitment reads as new to a title match. `propose_plan_change`'s rework carries the lineage
   *  explicitly, which is what makes a rename safe THERE. This pins the boundary. */
  it('cannot follow a rename on its own — that is what carrying the id explicitly is for', () => {
    const proposed: Partial<Activity>[] = [{ title: 'Easy run' }];
    inheritCommitmentIds(proposed, [prev('Easy base run - post-recovery assessment', 'c-old')]);
    expect(proposed[0]!.commitment_id).toBeUndefined();
  });
});
