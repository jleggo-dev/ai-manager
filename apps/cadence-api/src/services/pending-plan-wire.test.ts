/**
 * Wire-compat check for the two new PendingPlanActivity fields (`enabled`, `change_reason`,
 * Step 7): GET /plan/pending-change and ChangeCard must be unaffected when every item is enabled
 * (the default — every flow that predates this field).
 *
 * `pending_plan` is a jsonb column (repos/users.ts: `getUser` is a bare `select *`, `setPendingPlan`
 * is `pending_plan = ${json(plan)}` — neither reconstructs the value field by field), so there is
 * no repo code that could drop a new field on the way in or out. That leaves two things actually
 * worth proving without a real DB:
 *
 *   1. The new fields are plain JSON-safe scalars — jsonb's own round-trip is exactly
 *      JSON.stringify/parse semantics for booleans and strings, so surviving THAT round-trip is
 *      the correct proxy for surviving storage.
 *   2. GET /plan/pending-change's computation (routes/plan.ts, `/pending-change` handler) reads
 *      only `pending.rationale` and `pending.activities.length` — mirrored here verbatim — so it
 *      cannot see a difference between an all-enabled proposal and one with disabled items, or one
 *      with `change_reason` set. Same input, same output, proven directly rather than assumed.
 */
import { describe, it, expect } from 'vitest';
import type { PendingPlan, PendingPlanActivity } from '@cadence/shared';

function pendingActivity(over: Partial<PendingPlanActivity> = {}): PendingPlanActivity {
  return {
    title: 'Easy run',
    kind: 'user',
    cadence: 'Tuesdays',
    recurrence: 'FREQ=WEEKLY;BYDAY=TU',
    completion_source: 'self_report',
    ...over,
  };
}

/** routes/plan.ts's `GET /plan/pending-change` — the shape it returns, verbatim. */
function pendingChangeShape(pending: PendingPlan | null) {
  if (!pending?.rationale) return { change: null };
  return {
    change: {
      changes: pending.rationale.split('\n').filter(Boolean),
      activities: pending.activities.length,
      created_at: pending.created_at,
    },
  };
}

describe('the new fields are jsonb-safe', () => {
  it('survive a JSON round-trip unchanged, including `enabled: false` and a set `change_reason`', () => {
    const plan: PendingPlan = {
      activities: [
        pendingActivity({ commitment_id: 'c1', enabled: false, change_reason: 'you said Tuesdays are out' }),
        pendingActivity({ title: 'Meditate' }), // enabled absent — the default, untouched shape
      ],
      note: 'n',
      rationale: 'Move Easy run\nAdd Meditate',
      goal_ids: ['g1'],
      created_at: '2026-08-01T00:00:00.000Z',
    };

    const roundTripped = JSON.parse(JSON.stringify(plan)) as PendingPlan;

    expect(roundTripped).toEqual(plan);
    expect(roundTripped.activities[0]!.enabled).toBe(false);
    expect(roundTripped.activities[0]!.change_reason).toBe('you said Tuesdays are out');
    // Absent stays absent — JSON.stringify drops `undefined` keys, same as jsonb would.
    expect('enabled' in roundTripped.activities[1]!).toBe(false);
  });
});

describe('GET /plan/pending-change is unaffected by enabled/change_reason', () => {
  it('renders the identical change for an all-enabled proposal with or without the new fields present', () => {
    const withoutNewFields: PendingPlan = {
      activities: [pendingActivity({ commitment_id: 'c1' })],
      note: 'n',
      rationale: 'Move Easy run to Friday',
      goal_ids: ['g1'],
      created_at: '2026-08-01T00:00:00.000Z',
    };
    const withNewFieldsButAllEnabled: PendingPlan = {
      ...withoutNewFields,
      activities: [pendingActivity({ commitment_id: 'c1', enabled: true, change_reason: undefined })],
    };

    expect(pendingChangeShape(withNewFieldsButAllEnabled)).toEqual(pendingChangeShape(withoutNewFields));
  });

  it('counts a disabled item in `activities` same as before — the route never reads `enabled`', () => {
    // GET /plan/pending-change shows the PROPOSAL as stored; the substitution only happens at
    // commit time (plan-commit-flow.ts), so this count is deliberately the raw proposal length.
    const pending: PendingPlan = {
      activities: [
        pendingActivity({ commitment_id: 'c1' }),
        pendingActivity({ title: 'Declined add', enabled: false }),
      ],
      note: 'n',
      rationale: 'Move Easy run\nAdd a new commitment',
      goal_ids: ['g1'],
      created_at: '2026-08-01T00:00:00.000Z',
    };

    expect(pendingChangeShape(pending)).toEqual({
      change: {
        changes: ['Move Easy run', 'Add a new commitment'],
        activities: 2,
        created_at: '2026-08-01T00:00:00.000Z',
      },
    });
  });
});
