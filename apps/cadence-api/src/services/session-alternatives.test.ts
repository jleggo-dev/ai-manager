/**
 * The bounds on the Change sheet's inputs (walkthrough v3 R3): alternatives are capped at three,
 * nameless ones are dropped, equipment names are bounded, a URL never gets through as a video
 * phrase, and nothing the coach might write as a reason is kept. Both writers — the session
 * normalizer and the alternative-item route — go through these functions.
 */
import { describe, expect, it } from 'vitest';
import { ALTERNATIVES_MAX, ALTERNATIVE_EQUIPMENT_MAX, EQUIPMENT_NAME_MAX, ITEM_NAME_MAX } from '@cadence/shared';
import { normalizeAlternative, normalizeAlternatives, normalizeSuggestedLoad } from './session-alternatives.ts';
import { normalizeSession } from './session-normalize.ts';

const thrust = {
  name: 'Kettlebell hip thrust',
  sets: 2,
  reps: 12,
  load: '40 lb',
  detail: 'Shoulders on the bench, kettlebell on your hips.',
  video_query: 'kettlebell hip thrust form',
  equipment: ['Bench', 'kettlebell'],
};

describe('normalizeAlternative', () => {
  it('keeps the quantities, the cue, the search phrase and the equipment', () => {
    expect(normalizeAlternative(thrust)).toEqual(thrust);
  });

  it('a nameless alternative is nothing to show', () => {
    expect(normalizeAlternative({ reps: 10, equipment: [] })).toBeNull();
    expect(normalizeAlternative({ name: '   ' })).toBeNull();
    expect(normalizeAlternative('hip thrust')).toBeNull();
    expect(normalizeAlternative(null)).toBeNull();
  });

  it('equipment is a bounded list of plain names; anything else is an empty list ("No tools")', () => {
    expect(normalizeAlternative({ name: 'Clamshell' })?.equipment).toEqual([]);
    expect(normalizeAlternative({ name: 'Clamshell', equipment: 'band' })?.equipment).toEqual([]);
    const many = normalizeAlternative({
      name: 'Row',
      equipment: ['a'.repeat(EQUIPMENT_NAME_MAX + 20), 'band', 3, '', 'bench', 'bar', 'mat', 'box', 'rope', 'bell'],
    });
    expect(many?.equipment).toHaveLength(ALTERNATIVE_EQUIPMENT_MAX);
    expect(many?.equipment[0]).toHaveLength(EQUIPMENT_NAME_MAX);
    expect(many?.equipment[0]!.endsWith('…')).toBe(true);
  });

  it('a link is never a video phrase, and a long name is cut like any item name', () => {
    expect(normalizeAlternative({ name: 'Row', video_query: 'https://youtube.com/x' })?.video_query).toBeUndefined();
    expect(normalizeAlternative({ name: 'r'.repeat(ITEM_NAME_MAX + 5) })?.name).toHaveLength(ITEM_NAME_MAX);
  });

  it('writes no reason, whatever the coach sent', () => {
    const a = normalizeAlternative({ ...thrust, reason: 'easier on the knee', why: 'x' }) as unknown as Record<
      string,
      unknown
    >;
    expect(a).not.toHaveProperty('reason');
    expect(a).not.toHaveProperty('why');
  });
});

describe('normalizeAlternatives', () => {
  it('caps the list and drops the nameless', () => {
    const raw = [thrust, { name: 'Clamshell' }, { reps: 9 }, { name: 'Bridge march' }, { name: 'Step-up' }];
    const kept = normalizeAlternatives(raw)!;
    expect(kept).toHaveLength(ALTERNATIVES_MAX);
    expect(kept.map((a) => a.name)).toEqual(['Kettlebell hip thrust', 'Clamshell', 'Bridge march']);
  });

  it('nothing usable means no key, not an empty list', () => {
    expect(normalizeAlternatives([])).toBeUndefined();
    expect(normalizeAlternatives([{ reps: 9 }])).toBeUndefined();
    expect(normalizeAlternatives('none')).toBeUndefined();
  });
});

describe('normalizeSession carries the two fields', () => {
  it('an item with alternatives and a suggested load keeps both, bounded', () => {
    const s = normalizeSession({
      blocks: [
        {
          label: 'Main',
          items: [
            {
              name: 'Glute bridge',
              sets: 2,
              reps: 12,
              load: 'bodyweight',
              suggested_load: '15 lb',
              alternatives: [thrust],
            },
          ],
        },
      ],
    });
    const item = s!.blocks[0]!.items[0]!;
    expect(item.suggested_load).toBe('15 lb');
    expect(item.alternatives).toEqual([thrust]);
  });

  it('an item without them carries neither key', () => {
    const s = normalizeSession({ blocks: [{ label: 'Main', items: [{ name: 'Glute bridge', sets: 2, reps: 12 }] }] });
    const item = s!.blocks[0]!.items[0]! as unknown as Record<string, unknown>;
    expect(item).not.toHaveProperty('alternatives');
    expect(item).not.toHaveProperty('suggested_load');
    expect(normalizeSuggestedLoad(undefined)).toBeUndefined();
    expect(normalizeSuggestedLoad('  ')).toBeUndefined();
  });
});
