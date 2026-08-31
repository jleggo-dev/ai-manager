import { describe, expect, it } from 'vitest';
import { validateComposedLayout, type ComposeValidationContext } from './progress-layout-validate.ts';

/**
 * The gate between the compose job and the store (progress-layout-validate.ts): strict json_schema
 * guarantees TYPES, these tests guarantee the CONTENT judgments — a kind must be renderable, a
 * goal must be one the job was shown, a title must name the thing (never the area), and a bad
 * layout is rejected WHOLE with its evidence, never half-applied.
 */

const CTX: ComposeValidationContext = {
  availability: {
    has_weight: true,
    has_workout_history: true,
    has_feedback: { mind: true, movement: false },
    has_food_usage: true,
    has_felt: true,
    has_repertoire: true,
    repertoire_goal_ids: ['g-piano'],
    activities: ['Morning run', 'Strength — lower body'],
  },
  goalIds: ['g-books', 'g-sits', 'g-piano'],
};

const GOOD = {
  sections: [
    { id: 'w-rhythm', kind: 'rhythm', title: 'How you showed up' },
    { id: 'w-weight', kind: 'trend_vs_target', title: 'Your weight', source: { measure: 'weight' } },
    { id: 'w-runs', kind: 'dated_sessions', title: 'Your runs', source: { activity: 'Morning run' } },
    { id: 'w-sits', kind: 'balance', title: 'Your sits', source: { feedback_kind: 'mind' } },
    { id: 'w-books', kind: 'count_toward', title: 'Your reading', source: { goal_id: 'g-books' } },
    { id: 'w-history', kind: 'history', title: 'History' },
  ],
};

function expectRejected(raw: unknown, needle: string, ctx: ComposeValidationContext = CTX) {
  const v = validateComposedLayout(raw, ctx);
  expect(v.ok).toBe(false);
  if (!v.ok) expect(v.reasons.join('\n')).toContain(needle);
}

describe('validateComposedLayout', () => {
  it('accepts a bindable layout and forces version/status itself — never from the model', () => {
    const v = validateComposedLayout({ ...GOOD, version: 99, status: 'committed' }, CTX);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.layout.version).toBe(1);
      expect(v.layout.status).toBe('draft');
      expect(v.layout.sections.map((s) => s.id)).toEqual([
        'w-rhythm',
        'w-weight',
        'w-runs',
        'w-sits',
        'w-books',
        'w-history',
      ]);
    }
  });

  it('rebuilds sections from known-good fields — extra model keys never reach the store', () => {
    const noisy = {
      sections: [{ id: 'w-rhythm', kind: 'rhythm', title: 'How you showed up', confidence: 0.9, emoji: '🔥' }],
    };
    const v = validateComposedLayout(noisy, CTX);
    expect(v.ok).toBe(true);
    if (v.ok) expect(Object.keys(v.layout.sections[0]!)).toEqual(['id', 'kind', 'title']);
  });

  it('drops a nonsense window as noise rather than rejecting the layout for it', () => {
    const v = validateComposedLayout(
      { sections: [{ id: 'a', kind: 'rhythm', title: 'How you showed up', source: { window: 'fortnight' } }] },
      CTX,
    );
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.layout.sections[0]!.source).toBeUndefined();
  });

  it('rejects a kind outside the catalog', () => {
    expectRejected({ sections: [{ id: 'a', kind: 'streak_meter', title: 'X' }] }, 'not one of the catalog');
  });

  it('rejects a goal_id the job was never shown', () => {
    expectRejected(
      { sections: [{ id: 'a', kind: 'count_toward', title: 'Your reading', source: { goal_id: 'g-fake' } }] },
      'not one of the goals it was shown',
    );
  });

  it('rejects an activity with no logged sessions, naming what IS available', () => {
    expectRejected(
      { sections: [{ id: 'a', kind: 'dated_sessions', title: 'Your swims', source: { activity: 'Swim' } }] },
      'available activities: Morning run',
    );
  });

  it('rejects trend_vs_target when no weight data is on file', () => {
    expectRejected(GOOD, 'no weight data on file', {
      ...CTX,
      availability: { ...CTX.availability, has_weight: false },
    });
  });

  it('rejects balance for a feedback kind with no answered rows', () => {
    expectRejected(
      { sections: [{ id: 'a', kind: 'balance', title: 'Your lifts', source: { feedback_kind: 'movement' } }] },
      'no answered movement feedback',
    );
  });

  it('accepts felt_week only while a daily check-in mood exists in the last four weeks', () => {
    const layout = { sections: [{ id: 'a', kind: 'felt_week', title: 'Calmer evenings' }] };
    expect(validateComposedLayout(layout, CTX).ok).toBe(true);
    expectRejected(layout, 'no daily check-in moods in the last four weeks', {
      ...CTX,
      availability: { ...CTX.availability, has_felt: false },
    });
  });

  it('accepts repertoire scoped to a goal with items, and unscoped', () => {
    const v = validateComposedLayout(
      {
        sections: [
          { id: 'a', kind: 'repertoire', title: 'Piano repertoire', source: { goal_id: 'g-piano' } },
          { id: 'b', kind: 'repertoire', title: 'What you keep' },
        ],
      },
      CTX,
    );
    expect(v.ok).toBe(true);
  });

  it('rejects repertoire when nothing is on file, or scoped to a goal without items', () => {
    expectRejected(
      { sections: [{ id: 'a', kind: 'repertoire', title: 'Piano repertoire' }] },
      'no repertoire on file',
      {
        ...CTX,
        availability: { ...CTX.availability, has_repertoire: false, repertoire_goal_ids: [] },
      },
    );
    expectRejected(
      { sections: [{ id: 'a', kind: 'repertoire', title: 'Your reading', source: { goal_id: 'g-books' } }] },
      'no repertoire items for goal "g-books"',
    );
    expectRejected(
      { sections: [{ id: 'a', kind: 'repertoire', title: 'Piano', source: { goal_id: 'g-fake' } }] },
      'not one of the goals it was shown',
    );
  });

  it('rejects a title that names an area instead of the thing being watched', () => {
    expectRejected({ sections: [{ id: 'a', kind: 'rhythm', title: 'Movement' }] }, 'names an area');
  });

  it('rejects duplicate section ids', () => {
    expectRejected(
      {
        sections: [
          { id: 'dup', kind: 'rhythm', title: 'How you showed up' },
          { id: 'dup', kind: 'shelf', title: 'Bests & firsts' },
        ],
      },
      'used by more than one section',
    );
  });

  it('rejects history anywhere but last, and more than one of it', () => {
    expectRejected(
      {
        sections: [
          { id: 'h', kind: 'history', title: 'History' },
          { id: 'r', kind: 'rhythm', title: 'How you showed up' },
        ],
      },
      'must be the last section',
    );
    expectRejected(
      {
        sections: [
          { id: 'h1', kind: 'history', title: 'History' },
          { id: 'h2', kind: 'history', title: 'History' },
        ],
      },
      'at most one',
    );
  });

  it('rejects the whole layout when any section fails — never a silent partial', () => {
    const oneBad = {
      sections: [
        ...GOOD.sections.slice(0, 5),
        { id: 'w-bad', kind: 'count_toward', title: 'X', source: { goal_id: 'nope' } },
      ],
    };
    const v = validateComposedLayout(oneBad, CTX);
    expect(v.ok).toBe(false);
  });

  it('rejects empty and shapeless inputs plainly', () => {
    expectRejected({ sections: [] }, 'nothing to propose');
    expectRejected(null, 'did not return a "sections" array');
    expectRejected({ sections: 'yes' }, 'did not return a "sections" array');
  });
});
