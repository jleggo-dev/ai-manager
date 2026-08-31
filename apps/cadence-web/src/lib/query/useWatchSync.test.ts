import { describe, it, expect } from 'vitest';
import { planSignature } from './useWatchSync.ts';
import type { PlanViewData } from '../api.ts';

/**
 * The signature is the whole sync policy: it decides when a push happens at all. These tests are
 * about what counts as "the week changed" — get it too loose and the wrist goes stale, too tight
 * and every render spends a network round trip and a WatchConnectivity transfer.
 */
function plan(over: Partial<PlanViewData> = {}): PlanViewData {
  return {
    hasPlan: true,
    stage: 'committed',
    version: 3,
    committedAt: '2026-09-01T00:00:00.000Z',
    activities: [],
    week: [
      {
        date: '2026-09-07',
        weekday: 'Mon',
        dayNum: 7,
        isToday: true,
        occurrences: [{ occurrence_id: 'a', activity_id: 'act', title: 'Strength', kind: 'user', status: 'pending' }],
      },
    ],
    consistency: { kept: 0, window: 7 },
    ...over,
  };
}

describe('planSignature', () => {
  it('is null before there is a plan — nothing to sync', () => {
    expect(planSignature(undefined)).toBeNull();
    expect(planSignature(plan({ hasPlan: false }))).toBeNull();
    expect(planSignature(plan({ week: [] }))).toBeNull();
  });

  it('is stable across identical plans, so an unchanged week never re-pushes', () => {
    expect(planSignature(plan())).toBe(planSignature(plan()));
  });

  it('changes when a session is finished', () => {
    const done = plan({
      week: [
        {
          date: '2026-09-07',
          weekday: 'Mon',
          dayNum: 7,
          isToday: true,
          occurrences: [{ occurrence_id: 'a', activity_id: 'act', title: 'Strength', kind: 'user', status: 'done' }],
        },
      ],
    });
    expect(planSignature(done)).not.toBe(planSignature(plan()));
  });

  it('changes on a replan', () => {
    expect(planSignature(plan({ version: 4 }))).not.toBe(planSignature(plan()));
    expect(planSignature(plan({ committedAt: '2026-09-02T00:00:00.000Z' }))).not.toBe(planSignature(plan()));
  });

  it('changes when the day rolls over, even if the content is identical', () => {
    // A week identical in content is still a DIFFERENT week to a wrist once midnight passes —
    // today's row has to move, and only the date says so.
    const tomorrow = plan({
      week: [
        {
          date: '2026-09-08',
          weekday: 'Tue',
          dayNum: 8,
          isToday: true,
          occurrences: [{ occurrence_id: 'a', activity_id: 'act', title: 'Strength', kind: 'user', status: 'pending' }],
        },
      ],
    });
    expect(planSignature(tomorrow)).not.toBe(planSignature(plan()));
  });

  it('changes when an occurrence is added or removed', () => {
    const extra = plan({
      week: [
        {
          date: '2026-09-07',
          weekday: 'Mon',
          dayNum: 7,
          isToday: true,
          occurrences: [
            { occurrence_id: 'a', activity_id: 'act', title: 'Strength', kind: 'user', status: 'pending' },
            { occurrence_id: 'b', activity_id: 'act2', title: 'Sit', kind: 'user', status: 'pending' },
          ],
        },
      ],
    });
    expect(planSignature(extra)).not.toBe(planSignature(plan()));
  });
});
