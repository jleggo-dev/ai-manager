import { describe, it, expect } from 'vitest';
import {
  BodyValidationError,
  parseBody,
  logMealBodySchema,
  macroTargetsBodySchema,
  occurrenceLogBodySchema,
  weighInBodySchema,
  occurrenceStatusBodySchema,
  progressEventBodySchema,
  createGoalBodySchema,
  createEquipmentBodySchema,
  patchProfileBodySchema,
  patchRepertoireItemBodySchema,
  replanSteerBodySchema,
} from './body.ts';

describe('parseBody / nutrition schemas', () => {
  it('rejects empty meal bodies', () => {
    expect(() => parseBody(logMealBodySchema, {})).toThrow(BodyValidationError);
    expect(() => parseBody(logMealBodySchema, { text: '  ' })).toThrow(
      /words, a photo, a food_id, a recipe_id, items, or a parsed preview/,
    );
  });

  it('accepts text and optional meal kind', () => {
    expect(parseBody(logMealBodySchema, { text: ' oatmeal ', meal: 'breakfast' })).toEqual({
      text: 'oatmeal',
      meal: 'breakfast',
      photo: undefined,
      food_id: undefined,
      recipe_id: undefined,
      serving_index: undefined,
      quantity: undefined,
      date: undefined,
    });
  });

  it('rejects non-image photo strings', () => {
    expect(() => parseBody(logMealBodySchema, { photo: 'http://x' })).toThrow(/data:image/);
  });

  it('accepts deterministic food_id log without text/photo', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      parseBody(logMealBodySchema, { food_id: id, meal: 'breakfast', quantity: 2, serving_index: 0 }),
    ).toMatchObject({ food_id: id, meal: 'breakfast', quantity: 2, serving_index: 0, text: '' });
  });

  it('accepts recipe_id with servings alias → quantity', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    expect(parseBody(logMealBodySchema, { recipe_id: id, meal: 'dinner', servings: 2 })).toMatchObject({
      recipe_id: id,
      meal: 'dinner',
      quantity: 2,
      food_id: undefined,
      text: '',
    });
  });

  it('accepts a plate of items without text/photo', () => {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    expect(
      parseBody(logMealBodySchema, {
        items: [{ food_id: a, serving_index: 0, quantity: 1.5 }, { food_id: b }],
        meal: 'lunch',
      }),
    ).toMatchObject({
      items: [{ food_id: a, serving_index: 0, quantity: 1.5 }, { food_id: b }],
      meal: 'lunch',
      text: '',
    });
  });

  it('rejects items with a non-uuid food_id', () => {
    expect(() => parseBody(logMealBodySchema, { items: [{ food_id: 'nope' }] })).toThrow(/food_id must be a uuid/);
  });

  it('rejects food_id and recipe_id together', () => {
    const food = '11111111-1111-4111-8111-111111111111';
    const recipe = '22222222-2222-4222-8222-222222222222';
    expect(() => parseBody(logMealBodySchema, { food_id: food, recipe_id: recipe })).toThrow(/mutually exclusive/);
  });

  it('accepts macro target numbers (passthrough for service-side sanitize)', () => {
    expect(parseBody(macroTargetsBodySchema, { kcal: 2200, protein_g: 110 })).toMatchObject({
      kcal: 2200,
      protein_g: 110,
    });
  });
});

describe('parseBody / plan review progress schemas', () => {
  it('trims and caps replan steer', () => {
    expect(parseBody(replanSteerBodySchema, { steer: '  more runs  ' })).toEqual({ steer: 'more runs' });
    expect(parseBody(replanSteerBodySchema, {})).toEqual({ steer: undefined });
  });

  it('requires non-empty occurrence log text', () => {
    expect(() => parseBody(occurrenceLogBodySchema, {})).toThrow(/text required/);
    expect(() => parseBody(occurrenceLogBodySchema, { text: '  ' })).toThrow(/text required/);
    expect(parseBody(occurrenceLogBodySchema, { text: ' felt strong ' })).toEqual({ text: 'felt strong' });
  });

  it('validates weigh-in weight + unit (coerces numeric strings)', () => {
    expect(parseBody(weighInBodySchema, { weight: '82.5', unit: 'kg' })).toEqual({ weight: 82.5, unit: 'kg' });
    expect(() => parseBody(weighInBodySchema, { weight: -1, unit: 'kg' })).toThrow(/weight/);
    expect(() => parseBody(weighInBodySchema, { weight: 80, unit: 'stone' })).toThrow(/unit/);
  });

  it('validates occurrence status enum', () => {
    expect(parseBody(occurrenceStatusBodySchema, { status: 'done' })).toEqual({ status: 'done' });
    expect(() => parseBody(occurrenceStatusBodySchema, { status: 'missed' })).toThrow(/pending\|done\|skipped/);
  });

  it('requires progress event label', () => {
    expect(parseBody(progressEventBodySchema, { label: ' finished Dune ', goal_id: null })).toEqual({
      label: 'finished Dune',
      goal_id: null,
    });
    expect(() => parseBody(progressEventBodySchema, { label: '  ' })).toThrow(/label required/);
  });

  it('validates review create goal / equipment / profile', () => {
    expect(parseBody(createGoalBodySchema, { title: '10k', area: 'movement', type: 'milestone' })).toMatchObject({
      title: '10k',
      area: 'movement',
      type: 'milestone',
    });
    expect(() => parseBody(createGoalBodySchema, { title: 'x', area: 'fitness', type: 'milestone' })).toThrow(/area/);
    expect(parseBody(createEquipmentBodySchema, { name: 'shoes', category: 'footwear' })).toEqual({
      name: 'shoes',
      category: 'footwear',
    });
    expect(parseBody(patchProfileBodySchema, { name: 'Alex' })).toEqual({ name: 'Alex' });
    expect(() => parseBody(patchProfileBodySchema, {})).toThrow(/name/);
  });
});

/**
 * `rank` on the repertoire item PATCH (P6 "the room": the Up next group is drag-ordered, and a
 * reorder writes each moved row's new 1-based rank). The rest of this schema — status/label/
 * composer/collection/catalogue — is covered at the route level in
 * progress-extras-repertoire.test.ts; this pins the schema's OWN rule for the one field this
 * parcel added, table-style: a real rank, and the near-misses a drag interaction could produce.
 */
describe('parseBody / repertoire item patch schema — rank', () => {
  it('accepts a real 1-based rank', () => {
    expect(parseBody(patchRepertoireItemBodySchema, { rank: 3 })).toMatchObject({ rank: 3 });
  });

  it('a rank-only body is something to update, not an empty PATCH', () => {
    expect(() => parseBody(patchRepertoireItemBodySchema, { rank: 1 })).not.toThrow();
  });

  it.each([
    [0, 'not a 1-based position'],
    [1.5, 'not a whole number'],
    ['2', 'not a number at all'],
  ])('rejects rank %j (%s)', (rank: number | string, _why: string) => {
    expect(() => parseBody(patchRepertoireItemBodySchema, { rank })).toThrow(BodyValidationError);
  });

  it('rejects an empty body even though rank is optional — the base "nothing to update" rule still holds', () => {
    expect(() => parseBody(patchRepertoireItemBodySchema, {})).toThrow(/nothing to update/);
  });
});
