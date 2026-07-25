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
  replanSteerBodySchema,
} from './body.ts';

describe('parseBody / nutrition schemas', () => {
  it('rejects empty meal bodies', () => {
    expect(() => parseBody(logMealBodySchema, {})).toThrow(BodyValidationError);
    expect(() => parseBody(logMealBodySchema, { text: '  ' })).toThrow(/words, a photo, or a food_id/);
  });

  it('accepts text and optional meal kind', () => {
    expect(parseBody(logMealBodySchema, { text: ' oatmeal ', meal: 'breakfast' })).toEqual({
      text: 'oatmeal',
      meal: 'breakfast',
      photo: undefined,
      food_id: undefined,
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
