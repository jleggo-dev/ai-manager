/**
 * Convert AI Admin expectedSchema.fields (custom descriptor) to JSON Schema
 * for Devs.ai v2 text.format.json_schema (OpenAI strict mode compatible).
 */

export interface ExpectedSchemaFieldDef {
  description?: string;
  type?: string;
  required?: boolean;
  items?: { type?: string; fields?: Record<string, ExpectedSchemaFieldDef> };
  allowedValues?: string[] | null;
  suggestedValues?: string[] | null;
}

export interface ExpectedSchemaInput {
  fields?: Record<string, ExpectedSchemaFieldDef>;
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
    const prop = mapFieldType(def?.type);
    if (def?.description) prop.description = def.description;
    if (def?.allowedValues?.length) {
      prop.enum = def.allowedValues;
    }
    if (def?.type === 'array' && def.items?.type) {
      prop.items = mapFieldType(def.items.type);
    }
    properties[name] = prop;
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
