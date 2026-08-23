import { describe, it, expect } from 'vitest';
import {
  expectedSchemaFieldsToJsonSchema,
  type ExpectedSchemaInput,
} from '../src/services/expected-schema-to-json-schema.ts';

/**
 * This translator decides what 24 production jobs' structured output is validated against, and it
 * had no tests at all. Nesting support was added because the shallow form asserted the envelope and
 * nothing else: a capture job whose entire contract lives inside `baseline_updates` and each
 * `goals[]` item was strict-validated on six top-level key names while everything that mattered went
 * unchecked. One model kept emitting a `days_per_week` that had been deleted from the prompt;
 * another emitted "lose weight, target 0 lbs". Neither broke the schema, because the schema was
 * silent.
 *
 * So the first duty here is proving the un-opted-in shape is unchanged — 24 jobs depend on it — and
 * the second is proving that declaring sub-fields actually forbids the key we chased all afternoon.
 */

type Obj = Record<string, unknown>;

function root(input: ExpectedSchemaInput): Obj {
  const out = expectedSchemaFieldsToJsonSchema(input);
  if (!out) throw new Error('expected a schema, got null');
  return out.format.schema as unknown as Obj;
}

/** One top-level property, failing loudly rather than threading `!` through every assertion. */
function field(input: ExpectedSchemaInput, key: string): Obj {
  const found = (root(input).properties as Record<string, Obj>)[key];
  if (!found) throw new Error(`no property "${key}"`);
  return found;
}

/** One sub-property of an already-converted object. */
function sub(o: Obj, key: string): Obj {
  const found = (o.properties as Record<string, Obj>)[key];
  if (!found) throw new Error(`no sub-property "${key}"`);
  return found;
}

describe('backward compatibility — a field without `fields` behaves exactly as before', () => {
  it('leaves a bare object permissive, contents unchecked', () => {
    expect(field({ fields: { baseline_updates: { type: 'object' } } }, 'baseline_updates')).toEqual({
      type: 'object',
      additionalProperties: true,
    });
  });

  it('keeps the string-item default for a bare array', () => {
    expect(field({ fields: { tags: { type: 'array' } } }, 'tags')).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('maps the scalar types and enums the old way', () => {
    const input: ExpectedSchemaInput = {
      fields: {
        name: { type: 'string' },
        n: { type: 'integer' },
        ok: { type: 'boolean' },
        confidence: { type: 'string', allowedValues: ['high', 'medium', 'low'] },
      },
    };
    expect(field(input, 'name')).toEqual({ type: 'string' });
    expect(field(input, 'n')).toEqual({ type: 'number' });
    expect(field(input, 'ok')).toEqual({ type: 'boolean' });
    expect(field(input, 'confidence')).toEqual({ type: 'string', enum: ['high', 'medium', 'low'] });
  });

  it('still requires every top-level key and forbids extras (strict mode)', () => {
    const schema = root({ fields: { a: { type: 'string' }, b: { type: 'object' } } });
    expect(schema.required).toEqual(['a', 'b']);
    expect(schema.additionalProperties).toBe(false);
    expect(expectedSchemaFieldsToJsonSchema({ fields: { a: { type: 'string' } } })?.format.strict).toBe(true);
  });

  it('returns null when there is nothing to assert', () => {
    expect(expectedSchemaFieldsToJsonSchema(null)).toBeNull();
    expect(expectedSchemaFieldsToJsonSchema({ fields: {} })).toBeNull();
  });
});

describe('nested objects', () => {
  it('makes an undeclared key structurally impossible — the days_per_week case', () => {
    const b = field(
      {
        fields: {
          baseline_updates: {
            type: 'object',
            fields: { age: { type: 'integer', nullable: true }, sex: { type: 'string', nullable: true } },
          },
        },
      },
      'baseline_updates',
    );
    // The whole point: a field deleted from the prompt can no longer reappear on a model's whim.
    expect(b.additionalProperties).toBe(false);
    expect(Object.keys(b.properties as Obj)).toEqual(['age', 'sex']);
    expect(b.required).toEqual(['age', 'sex']);
  });

  it('recurses to any depth', () => {
    const b = field(
      {
        fields: {
          baseline_updates: {
            type: 'object',
            fields: {
              availability: {
                type: 'object',
                nullable: true,
                fields: { session_minutes: { type: 'object', fields: { min: { type: 'integer' } } } },
              },
            },
          },
        },
      },
      'baseline_updates',
    );
    const mins = sub(sub(b, 'availability'), 'session_minutes');
    expect(sub(mins, 'min')).toEqual({ type: 'number' });
    expect(mins.additionalProperties).toBe(false);
  });
});

describe('array items with declared fields', () => {
  it('constrains each element instead of leaving it a free object', () => {
    const goals = field(
      {
        fields: {
          goals: {
            type: 'array',
            items: { fields: { title: { type: 'string' }, brief: { type: 'string', nullable: true } } },
          },
        },
      },
      'goals',
    );
    const item = goals.items as Obj;
    expect(item.type).toBe('object');
    expect(item.required).toEqual(['title', 'brief']);
    expect(item.additionalProperties).toBe(false);
  });
});

describe('nullability — "they did not say" has to stay legal', () => {
  it('widens a scalar so the honest answer is available', () => {
    expect(field({ fields: { sex: { type: 'string', nullable: true } } }, 'sex').type).toEqual(['string', 'null']);
  });

  it('widens an enum, because strict mode requires the key even when unanswerable', () => {
    const p = field(
      { fields: { time_of_day: { type: 'string', allowedValues: ['morning', 'evening'], nullable: true } } },
      'time_of_day',
    );
    expect(p.enum).toEqual(['morning', 'evening', null]);
    expect(p.type).toEqual(['string', 'null']);
  });

  it('widens a nested object so an entire unanswered section can be null', () => {
    const a = field(
      { fields: { availability: { type: 'object', nullable: true, fields: { windows: { type: 'array' } } } } },
      'availability',
    );
    expect(a.type).toEqual(['object', 'null']);
    expect(a.additionalProperties).toBe(false);
  });
});

/**
 * Bounding an array at the SOURCE — the strongest limit available on a job's output, because a
 * schema is enforced where a prompt is only requested. Added 2026-08-23 with the tool-output cap:
 * the cap is the circuit breaker, this is the thing that should stop it ever tripping.
 *
 * The ceiling is deliberately emitted twice — as the `maxItems` keyword AND folded into the
 * field's description. Strict json_schema accepts only a subset of JSON Schema, and we have not
 * measured how Devs.ai treats `maxItems`; a provider that silently drops the keyword would leave
 * an author believing they were bounded, which is worse than being unbounded knowingly. The prose
 * survives that.
 */
describe('maxItems — bounding an array where the provider can enforce it', () => {
  it('emits the keyword on an array field', () => {
    expect(field({ fields: { rows: { type: 'array', maxItems: 10 } } }, 'rows')).toMatchObject({
      type: 'array',
      maxItems: 10,
    });
  });

  it('also states the ceiling in the description, so a dropped keyword still bounds it', () => {
    const rows = field({ fields: { rows: { type: 'array', maxItems: 10 } } }, 'rows');
    expect(String(rows.description)).toContain('at most 10 items');
  });

  it('keeps the author’s own description and appends the ceiling to it', () => {
    const rows = field({ fields: { rows: { type: 'array', maxItems: 3, description: 'Matching foods.' } } }, 'rows');
    expect(String(rows.description)).toBe('Matching foods. Return at most 3 items.');
  });

  it('says "item" rather than "items" for a ceiling of one', () => {
    const rows = field({ fields: { rows: { type: 'array', maxItems: 1 } } }, 'rows');
    expect(String(rows.description)).toContain('at most 1 item.');
  });

  it('bounds an array of declared objects without disturbing its items schema', () => {
    const rows = field(
      { fields: { rows: { type: 'array', maxItems: 5, items: { fields: { name: { type: 'string' } } } } } },
      'rows',
    );
    expect(rows.maxItems).toBe(5);
    expect(sub(rows.items as Obj, 'name')).toEqual({ type: 'string' });
  });

  /** Opt-in: no shipped job sets it, so every existing schema must come out byte-identical. */
  it('changes nothing when it is not set', () => {
    expect(field({ fields: { rows: { type: 'array' } } }, 'rows')).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });

  it('ignores zero and nonsense rather than emitting a nonsense bound', () => {
    expect(field({ fields: { rows: { type: 'array', maxItems: 0 } } }, 'rows')).not.toHaveProperty('maxItems');
    expect(field({ fields: { rows: { type: 'array', maxItems: -3 } } }, 'rows')).not.toHaveProperty('maxItems');
  });

  it('is not applied to a non-array field', () => {
    expect(field({ fields: { name: { type: 'string', maxItems: 5 } } }, 'name')).not.toHaveProperty('maxItems');
  });
});
