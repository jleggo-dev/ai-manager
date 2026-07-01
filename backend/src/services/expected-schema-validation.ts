/**
 * Validate JSON job output against config.expectedSchema (field descriptors).
 */

import type { ExpectedSchemaInput, ExpectedSchemaFieldDef } from './expected-schema-to-json-schema.ts';

export interface SchemaFieldDetail {
  field: string;
  label: string;
  required: boolean;
  populated: boolean;
  typeCorrect: boolean;
  value: string | null;
}

export interface SchemaValidationResult {
  jsonValid: boolean;
  fieldsTotal: number;
  fieldsPopulated: number;
  fieldsCorrectType: number;
  requiredTotal: number;
  requiredPresent: number;
  unexpectedFields: number;
  fieldDetails: SchemaFieldDetail[];
  /** Human-readable failures for eval / API responses */
  errors: string[];
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const clean = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    const parsed = JSON.parse(clean);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isPopulated(val: unknown): boolean {
  return val != null && val !== '' && !(Array.isArray(val) && val.length === 0);
}

function isTypeCorrect(def: ExpectedSchemaFieldDef, val: unknown): boolean {
  if (!isPopulated(val)) return false;
  const t = String(def.type || '').toLowerCase();
  if (t === 'array') return Array.isArray(val);
  if (t === 'string') return typeof val === 'string';
  if (t === 'number' || t === 'integer') return typeof val === 'number';
  if (t === 'boolean') return typeof val === 'boolean';
  return true;
}

/** Validate text output against expectedSchema.fields. */
export function validateAgainstExpectedSchema(
  text: string,
  expectedSchema: ExpectedSchemaInput | null | undefined,
): SchemaValidationResult {
  const result: SchemaValidationResult = {
    jsonValid: false,
    fieldsTotal: 0,
    fieldsPopulated: 0,
    fieldsCorrectType: 0,
    requiredTotal: 0,
    requiredPresent: 0,
    unexpectedFields: 0,
    fieldDetails: [],
    errors: [],
  };

  const fields = expectedSchema?.fields;
  if (!fields || Object.keys(fields).length === 0) return result;

  const parsed = parseJsonObject(text);
  if (!parsed) {
    result.errors.push('Output is not valid JSON object');
    return result;
  }
  result.jsonValid = true;

  const schemaKeys = new Set(Object.keys(fields));

  for (const [name, def] of Object.entries(fields)) {
    result.fieldsTotal++;
    if (def.required) result.requiredTotal++;

    const val = parsed[name];
    const populated = isPopulated(val);
    const typeCorrect = populated && isTypeCorrect(def, val);

    if (populated) {
      result.fieldsPopulated++;
      if (def.required) result.requiredPresent++;
      if (typeCorrect) result.fieldsCorrectType++;
      else result.errors.push(`Field "${name}" has wrong type (expected ${def.type || 'any'})`);
    } else if (def.required) {
      result.errors.push(`Required field "${name}" is missing or empty`);
    }

    result.fieldDetails.push({
      field: name,
      label: def.description || name,
      required: !!def.required,
      populated,
      typeCorrect,
      value: populated
        ? (Array.isArray(val) ? val.join(', ') : String(val)).slice(0, 100)
        : null,
    });
  }

  result.unexpectedFields = Object.keys(parsed).filter((k) => !schemaKeys.has(k)).length;
  if (result.unexpectedFields > 0) {
    result.errors.push(`${result.unexpectedFields} unexpected field(s) not in schema`);
  }

  return result;
}

/** True when JSON is valid and all required schema fields are present with correct types. */
export function expectedSchemaPasses(
  text: string,
  expectedSchema: ExpectedSchemaInput | null | undefined,
): boolean {
  const fields = expectedSchema?.fields;
  if (!fields || Object.keys(fields).length === 0) return true;
  const v = validateAgainstExpectedSchema(text, expectedSchema);
  return v.jsonValid && v.errors.length === 0;
}
