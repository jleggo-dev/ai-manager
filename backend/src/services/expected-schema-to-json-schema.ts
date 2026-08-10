/**
 * Convert AI Admin expectedSchema.fields (custom descriptor) to JSON Schema
 * for Devs.ai v2 text.format.json_schema (OpenAI strict mode compatible).
 *
 * NESTING (added after a real failure): a field of `type: "object"` used to become
 * `{ type: 'object', additionalProperties: true }` — an assertion about the envelope and nothing
 * about the contents. A capture job whose whole contract lives inside `baseline_updates` and each
 * `goals[]` item was therefore strict-validated on six top-level key names while the parts that
 * actually matter went unchecked. One model kept emitting a `days_per_week` that had been deleted
 * from the prompt, and another emitted "lose weight, target 0 lbs"; neither violated the schema,
 * because the schema said nothing. Declaring `fields` on an object (or on `items`) now produces
 * real `properties` with `additionalProperties: false`, so a field nobody asked for is a
 * structural error rather than a matter of the model's taste.
 *
 * A field WITHOUT `fields` keeps the old permissive shape exactly — 24 jobs rely on it, and this
 * change must be invisible to every one of them that hasn't opted in.
 *
 * NULLABILITY matters more than it looks. OpenAI strict mode requires every declared property to
 * appear in `required`, so "optional" cannot be expressed by omission: a required, non-nullable
 * `availability` would force a model to invent an answer for someone who never gave one, which is
 * the exact failure this schema exists to prevent. `nullable: true` widens the type to include
 * `null` so "they didn't say" stays a legal, easy answer.
 */

export interface ExpectedSchemaFieldDef {
  description?: string;
  type?: string;
  required?: boolean;
  items?: { type?: string; fields?: Record<string, ExpectedSchemaFieldDef> };
  allowedValues?: string[] | null;
  suggestedValues?: string[] | null;
  /** Declared sub-properties for an object field. Absent = the old permissive object. */
  fields?: Record<string, ExpectedSchemaFieldDef>;
  /** Let the model answer `null` rather than invent a value it was never given. */
  nullable?: boolean;
}

export interface ExpectedSchemaInput {
  fields?: Record<string, ExpectedSchemaFieldDef>;
}

/** Widen a mapped type to admit null, for both plain types and enums. */
function withNull(prop: Record<string, unknown>): Record<string, unknown> {
  const next = { ...prop };
  const t = next.type;
  if (typeof t === 'string') next.type = [t, 'null'];
  else if (Array.isArray(t) && !t.includes('null')) next.type = [...t, 'null'];
  if (Array.isArray(next.enum) && !next.enum.includes(null)) next.enum = [...next.enum, null];
  return next;
}

/**
 * Build the object form used whenever sub-properties are declared: every key required (strict
 * mode's rule) and nothing else permitted, which is what makes an undeclared key impossible.
 */
function objectFromFields(fields: Record<string, ExpectedSchemaFieldDef>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(fields)) properties[name] = mapField(def);
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function mapFieldType(aiAdminType: string | undefined): Record<string, unknown> {
  const t = String(aiAdminType || 'string').toLowerCase();
  switch (t) {
    case 'number':
    case 'integer':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'array':
      return { type: 'array', items: { type: 'string' } };
    case 'object':
      return { type: 'object', additionalProperties: true };
    default:
      return { type: 'string' };
  }
}

/** One field descriptor → one JSON Schema property, recursing through objects and array items. */
function mapField(def: ExpectedSchemaFieldDef | undefined): Record<string, unknown> {
  const type = String(def?.type || 'string').toLowerCase();

  let prop: Record<string, unknown>;
  if (type === 'object' && def?.fields && Object.keys(def.fields).length > 0) {
    prop = objectFromFields(def.fields);
  } else if (type === 'array') {
    prop = { type: 'array' };
    if (def?.items?.fields && Object.keys(def.items.fields).length > 0) {
      prop.items = objectFromFields(def.items.fields);
    } else if (def?.items?.type) {
      prop.items = mapFieldType(def.items.type);
    } else {
      prop.items = { type: 'string' };
    }
  } else {
    prop = mapFieldType(def?.type);
  }

  if (def?.description) prop.description = def.description;
  if (def?.allowedValues?.length) prop.enum = def.allowedValues;
  return def?.nullable ? withNull(prop) : prop;
}

/**
 * Convert expectedSchema.fields → JSON Schema object for strict json_schema format.
 * Returns null when no fields are defined.
 */
export function expectedSchemaFieldsToJsonSchema(
  expectedSchema: ExpectedSchemaInput | null | undefined,
  schemaName = 'job_output',
): { format: { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict: boolean } } | null {
  const fields = expectedSchema?.fields;
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) return null;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, def] of Object.entries(fields)) {
    properties[name] = mapField(def);
    if (def?.required) required.push(name);
  }

  /* OpenAI strict json_schema: all properties should be required for strict mode */
  const allKeys = Object.keys(properties);
  const strictRequired = allKeys.length > 0 ? allKeys : required;

  return {
    format: {
      type: 'json_schema',
      name: schemaName,
      schema: {
        type: 'object',
        properties,
        required: strictRequired,
        additionalProperties: false,
      },
      strict: true,
    },
  };
}
