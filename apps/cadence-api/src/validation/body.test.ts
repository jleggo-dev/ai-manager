import { describe, it, expect } from 'vitest';
import {
  BodyValidationError,
  parseBody,
  logMealBodySchema,
  previewMealBodySchema,
  previewMealAnswerBodySchema,
  previewFromReadingBodySchema,
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

  it.each([
    ['a real day', '2026-02-28', true],
    ['a leap day', '2028-02-29', true],
    ['Feb 30 — the shape passes, the day does not exist', '2026-02-30', false],
    ['Feb 29 in a common year', '2026-02-29', false],
    ['no padding', '2026-2-8', false],
    ['a timestamp', '2026-02-28T00:00:00Z', false],
  ])('a meal date: %s', (_label, date, ok) => {
    const parse = () => parseBody(logMealBodySchema, { text: 'toast', date });
    if (ok) expect(parse()).toMatchObject({ date });
    else expect(parse).toThrow(/date must be YYYY-MM-DD/);
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

// A photo reading is prose — the one in the 2026-10-31 report ran to a markdown summary with
// six toppings and their grams — and sending it down the words path's 500-character preview
// failed every photo added to an open meal with a bare 400.
describe('parseBody / photo preview schema', () => {
  const longReading = 'Pizza, hand-tossed crust, 14-inch, two slices. '.repeat(40);

  it.each([
    ['a long reading', { reading: longReading, meal: 'dinner' }],
    ['a reading with a caption', { reading: 'two slices of Hawaiian', caption: 'Two slices. Hawaiian 14 inch.' }],
    ['an empty reading (a failed read still prices from the caption)', { reading: '', caption: 'two slices' }],
  ])('accepts %s', (_name, body) => {
    expect(() => parseBody(previewFromReadingBodySchema, body)).not.toThrow();
  });

  it.each([
    ['no reading at all', { caption: 'two slices' }],
    ['a reading past 20,000 characters', { reading: 'x'.repeat(20_001) }],
    ['an unknown meal kind', { reading: 'pizza', meal: 'brunch-ish' }],
  ])('rejects %s', (_name, body) => {
    expect(() => parseBody(previewFromReadingBodySchema, body)).toThrow(BodyValidationError);
  });

  it('is needed: the words preview still refuses a reading this long', () => {
    expect(() => parseBody(previewMealBodySchema, { text: longReading })).toThrow(BodyValidationError);
  });
});

describe('parseBody / meal answer schema — a question row answered', () => {
  it('accepts a chosen answer with the slot, trimmed', () => {
    expect(
      parseBody(previewMealAnswerBodySchema, {
        asked_about: ' a glass of milk ',
        answer: ' Whole milk ',
        chosen: true,
        meal: 'breakfast',
      }),
    ).toEqual({ asked_about: 'a glass of milk', answer: 'Whole milk', chosen: true, meal: 'breakfast' });
  });

  it("accepts words and an answer at exactly the caps (a row's 200, a line's 120)", () => {
    const body = { asked_about: 'x'.repeat(200), answer: 'y'.repeat(120) };
    expect(parseBody(previewMealAnswerBodySchema, body)).toMatchObject(body);
  });

  it('accepts a typed answer with no chosen flag and no slot', () => {
    expect(parseBody(previewMealAnswerBodySchema, { asked_about: 'milk', answer: 'lactose-free' })).toEqual({
      asked_about: 'milk',
      answer: 'lactose-free',
      chosen: undefined,
      meal: undefined,
    });
  });

  it.each([
    ['no words to answer', { answer: 'Skim' }],
    ['no answer', { asked_about: 'milk' }],
    ['a blank answer', { asked_about: 'milk', answer: '   ' }],
    ["words past a row's 200", { asked_about: 'x'.repeat(201), answer: 'Skim' }],
    ['an answer past 120', { asked_about: 'milk', answer: 'x'.repeat(121) }],
    ['an unknown slot', { asked_about: 'milk', answer: 'Skim', meal: 'brunch' }],
  ])('rejects %s', (_name, body) => {
    expect(() => parseBody(previewMealAnswerBodySchema, body)).toThrow(BodyValidationError);
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
 * composer/collection/description — is covered at the route level in
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

/**
 * `note` on the repertoire item PATCH (P8: "the practice note gets a store" — how the work is going,
 * "bars 9-16", "p. 240", "first stanza", "for 5th kyu"). Same table shape as `rank` above: a real
 * value, and the near-misses a save could produce.
 */
describe('parseBody / repertoire item patch schema — note', () => {
  it('accepts a real note', () => {
    expect(parseBody(patchRepertoireItemBodySchema, { note: 'bars 9-16' })).toMatchObject({ note: 'bars 9-16' });
  });

  it('a note-only body is something to update, not an empty PATCH', () => {
    expect(() => parseBody(patchRepertoireItemBodySchema, { note: 'p. 240' })).not.toThrow();
  });

  it('trims surrounding whitespace', () => {
    expect(parseBody(patchRepertoireItemBodySchema, { note: '  first stanza  ' })).toMatchObject({
      note: 'first stanza',
    });
  });

  it('rejects a blank note — whitespace-only is not "nothing given", it is a bad value', () => {
    expect(() => parseBody(patchRepertoireItemBodySchema, { note: '   ' })).toThrow(BodyValidationError);
    expect(() => parseBody(patchRepertoireItemBodySchema, { note: '   ' })).toThrow(/must not be blank/);
  });

  it('rejects a note over 120 characters', () => {
    expect(() => parseBody(patchRepertoireItemBodySchema, { note: 'x'.repeat(121) })).toThrow(BodyValidationError);
  });

  it('accepts a note at exactly the 120-character bound', () => {
    expect(parseBody(patchRepertoireItemBodySchema, { note: 'x'.repeat(120) })).toMatchObject({
      note: 'x'.repeat(120),
    });
  });

  it('rejects an empty body even though note is optional — the base "nothing to update" rule still holds', () => {
    expect(() => parseBody(patchRepertoireItemBodySchema, {})).toThrow(/nothing to update/);
  });
});

describe("parsedMealSchema — the photo door's confirm", () => {
  const parsed = {
    meal: 'breakfast',
    items: [
      {
        name: 'Banana, raw',
        qty: 1,
        unit: 'medium',
        est: { kcal: 105 },
        food_id: '11111111-1111-4111-8111-111111111111',
        said: '1 medium banana',
      },
    ],
    macros: { kcal: 105 },
    confidence: null,
    flags: {},
    raw_text: '1 medium banana',
  };

  it('carries the stored photo and the reading they stood behind', () => {
    const out = parseBody(logMealBodySchema, {
      parsed: { ...parsed, photo_ref: 'u/2026-11-01/p.jpg', photo_reading: 'A banana.\n\n1 medium banana' },
    });
    expect(out.parsed?.photo_ref).toBe('u/2026-11-01/p.jpg');
    expect(out.parsed?.photo_reading).toBe('A banana.\n\n1 medium banana');
  });

  it('near-miss: a words card has neither, and an empty photo_ref is refused', () => {
    expect(parseBody(logMealBodySchema, { parsed }).parsed?.photo_ref).toBeUndefined();
    expect(() => parseBody(logMealBodySchema, { parsed: { ...parsed, photo_ref: '' } })).toThrow(BodyValidationError);
  });

  it("the words read run to the photo list's cap, not past it", () => {
    expect(
      parseBody(logMealBodySchema, { parsed: { ...parsed, raw_text: 'x'.repeat(1000) } }).parsed?.raw_text,
    ).toHaveLength(1000);
    expect(() => parseBody(logMealBodySchema, { parsed: { ...parsed, raw_text: 'x'.repeat(1001) } })).toThrow(
      BodyValidationError,
    );
  });
});
