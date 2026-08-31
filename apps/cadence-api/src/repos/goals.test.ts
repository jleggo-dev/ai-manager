/**
 * Pure — no DB. `retireGoal`/`restoreGoal` are plain SQL and covered indirectly by
 * routes/review.test.ts and coach-actions.test.ts (status transitions through the HTTP route and
 * the coach action). What IS worth pinning down here, with zero mocking, is the one contract this
 * file is the single source of truth for: which goal statuses Progress draws from. Settings Room
 * SR-1: retiring a goal parks it, and "everything it built — the 5k, the grip work — stays in
 * Progress" is only true if 'parked' stays in this list. services/progress.ts and
 * routes/progress-layout.ts both import it rather than repeating the array, so this test is
 * effectively a lock on both call sites at once.
 */
import { describe, it, expect } from 'vitest';
import { PROGRESS_GOAL_STATUSES } from './goals.ts';

describe('PROGRESS_GOAL_STATUSES', () => {
  it('includes parked — a retired goal keeps its Progress cards and history', () => {
    expect(PROGRESS_GOAL_STATUSES).toContain('parked');
  });

  it('still includes the ordinary live statuses', () => {
    expect(PROGRESS_GOAL_STATUSES).toContain('confirmed');
    expect(PROGRESS_GOAL_STATUSES).toContain('committed');
  });

  it('excludes completed/abandoned — those already have their own celebration/close, not a plan-shaped card', () => {
    expect(PROGRESS_GOAL_STATUSES).not.toContain('completed');
    expect(PROGRESS_GOAL_STATUSES).not.toContain('abandoned');
  });
});
