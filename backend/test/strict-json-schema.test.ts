/**
 * Which of the 29 schema jobs can go to the gateway strict, pinned by name.
 *
 * OpenAI strict mode rejects any object without `additionalProperties: false` (measured
 * 2026-10-29: `'additionalProperties' is required to be supplied and to be false`). The job
 * configs declare sub-fields on some objects and leave others bare (`{ type: "object" }`), and a
 * bare object cannot be closed without turning it into "an empty object". So the gateway sends
 * those jobs with `strict: false`, and this table says exactly which ones — a config change that
 * moves a job between the two lists has to move it here too, on purpose.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closeSchemaForStrictMode } from '../src/services/strict-json-schema.ts';
import {
  expectedSchemaFieldsToJsonSchema,
  type ExpectedSchemaInput,
} from '../src/services/expected-schema-to-json-schema.ts';

type Obj = Record<string, unknown>;
const CONFIG_PATH = fileURLToPath(new URL('../../config/ai-admin/ai-admin.config.json', import.meta.url));
const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
  jobs: Array<{ name: string; config?: { expectedSchema?: ExpectedSchemaInput } }>;
};

const schemaJobs = config.jobs.flatMap((j) => {
  const expectedSchema = j.config?.expectedSchema;
  if (!expectedSchema?.fields || Object.keys(expectedSchema.fields).length === 0) return [];
  const format = expectedSchemaFieldsToJsonSchema(expectedSchema);
  return format ? [{ name: j.name, schema: format.format.schema }] : [];
});

/** Jobs with at least one bare object: they go out with strict:false until their fields are declared. */
const STAYS_NON_STRICT = [
  'assess_goal',
  'capture_detour',
  'context_select',
  'discover_recipe',
  'estimate_food',
  'generate_meal_plan',
  'generate_recipe',
  'nutrition_baseline',
  'parse_fridge_photo',
  'parse_meal',
  'parse_meal_description',
  'parse_nutrition_label',
  'parse_session_log',
  'prescribe_session',
  'research_food',
  'surface_insights',
  'sweep_food_recipes',
].sort();

/** Every object anywhere in the schema is closed: additionalProperties false, all keys required. */
function everyObjectClosed(node: unknown, path = ''): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  const o = node as Obj;
  const problems: string[] = [];
  const t = o.type;
  const isObject = t === 'object' || (Array.isArray(t) && t.includes('object'));
  if (isObject) {
    const props = (o.properties as Obj | undefined) ?? {};
    const keys = Object.keys(props);
    if (keys.length === 0) {
      problems.push(`${path || '(root)'}: no properties`);
    } else {
      if (o.additionalProperties !== false) problems.push(`${path || '(root)'}: additionalProperties not false`);
      if (
        JSON.stringify([...((o.required as string[] | undefined) ?? [])].sort()) !== JSON.stringify([...keys].sort())
      ) {
        problems.push(`${path || '(root)'}: required ≠ all keys`);
      }
      for (const k of keys) problems.push(...everyObjectClosed(props[k], path ? `${path}.${k}` : k));
    }
  }
  if (o.items) problems.push(...everyObjectClosed(o.items, `${path}[]`));
  return problems;
}

describe('closeSchemaForStrictMode over every schema job in ai-admin.config.json', () => {
  it('sees the 29 jobs the evaluation counted', () => {
    expect(schemaJobs).toHaveLength(29);
  });

  it('sends exactly these jobs non-strict (a bare object somewhere in their schema)', () => {
    const nonStrict = schemaJobs
      .filter((j) => !closeSchemaForStrictMode(j.schema).strict)
      .map((j) => j.name)
      .sort();
    expect(nonStrict).toEqual(STAYS_NON_STRICT);
  });

  it.each(schemaJobs.filter((j) => !STAYS_NON_STRICT.includes(j.name)).map((j) => [j.name, j.schema] as const))(
    '%s goes strict with every object closed',
    (_name, schema) => {
      const result = closeSchemaForStrictMode(schema);
      expect(result.strict).toBe(true);
      expect(result.openPaths).toEqual([]);
      expect(everyObjectClosed(result.schema)).toEqual([]);
    },
  );

  it.each(schemaJobs.filter((j) => STAYS_NON_STRICT.includes(j.name)).map((j) => [j.name, j.schema] as const))(
    '%s names the bare objects that keep it non-strict',
    (_name, schema) => {
      const result = closeSchemaForStrictMode(schema);
      expect(result.strict).toBe(false);
      expect(result.openPaths.length).toBeGreaterThan(0);
      // The bare objects are the ONLY thing wrong: every declared object is still closed.
      const problems = everyObjectClosed(result.schema).filter((p) => !p.endsWith(': no properties'));
      expect(problems).toEqual([]);
    },
  );

  it('does not mutate the schema it was given', () => {
    const job = schemaJobs.find((j) => j.name === 'parse_meal');
    expect(job).toBeDefined();
    const before = JSON.stringify(job?.schema);
    closeSchemaForStrictMode(job?.schema ?? {});
    expect(JSON.stringify(job?.schema)).toBe(before);
  });
});

describe('closeSchemaForStrictMode — shapes', () => {
  it('closes an object that declared properties but forgot the strict-mode keywords', () => {
    const r = closeSchemaForStrictMode({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    });
    expect(r.strict).toBe(true);
    expect(r.schema.additionalProperties).toBe(false);
    expect(r.schema.required).toEqual(['a', 'b']);
  });

  it('closes nested objects and array items, and treats a nullable object the same', () => {
    const r = closeSchemaForStrictMode({
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'object', properties: { x: { type: 'string' } } } },
        maybe: { type: ['object', 'null'], properties: { y: { type: 'string' } } },
      },
    });
    expect(r.strict).toBe(true);
    expect(everyObjectClosed(r.schema)).toEqual([]);
  });

  it('reports the path of each bare object: top-level, nested, and inside array items', () => {
    const r = closeSchemaForStrictMode({
      type: 'object',
      properties: {
        flags: { type: 'object', additionalProperties: true },
        wrap: { type: 'object', properties: { deep: { type: 'object' } } },
        rows: { type: 'array', items: { type: 'object' } },
        fine: { type: 'string' },
      },
    });
    expect(r.strict).toBe(false);
    expect(r.openPaths).toEqual(['flags', 'wrap.deep', 'rows[]']);
  });
});
