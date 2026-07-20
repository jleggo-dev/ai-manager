import type {
  ExpectedSchema,
  SchemaFieldDefExtended,
  LegacySchemaFieldDef,
  ValidationResult,
  ValidationFieldResult,
} from './types';
import { ICP_SCHEMA_LEGACY } from './icpSchemaLegacy';

export function normaliseSchemaFields(expectedSchema: ExpectedSchema | null | undefined) {
  const fields = expectedSchema?.fields || {};
  const normalised: Record<string, LegacySchemaFieldDef> = {};
  for (const [name, def] of Object.entries(fields) as [string, SchemaFieldDefExtended][]) {
    normalised[name] = {
      label: def.description || name,
      type: def.type === 'array' ? 'multi' : 'single',
      required: !!def.required,
      allowedValues: def.allowedValues || null,
      suggestedValues: def.suggestedValues || null,
    };
  }
  return normalised;
}

/**
 * Validate a parsed JSON object against the response schema.
 * Uses the job's dynamic expectedSchema if provided, otherwise
 * falls back to the legacy ICP_SCHEMA_LEGACY for backward compat.
 *
 * @param {string} formattedText — raw AI response text
 * @param {object|null} expectedSchema — job's config.expectedSchema
 * @returns {{ valid, parseError, fields, summary, unexpectedFields }}
 */
export function validateResponseSchema(
  formattedText: string,
  expectedSchema: ExpectedSchema | null | undefined,
): ValidationResult {
  /* Determine which schema fields to use */
  const hasExpectedSchema = expectedSchema && Object.keys(expectedSchema.fields || {}).length > 0;
  const schemaToUse = hasExpectedSchema ? normaliseSchemaFields(expectedSchema) : ICP_SCHEMA_LEGACY;

  const result: ValidationResult = {
    valid: false,
    parseError: null as string | null,
    fields: [] as ValidationFieldResult[],
    summary: { total: 0, passed: 0, warnings: 0, errors: 0, missing: 0 },
    unexpectedFields: [] as string[],
  };

  /* Try to parse the formatted text as JSON */
  let parsed;
  try {
    parsed = JSON.parse(formattedText);
  } catch (err: unknown) {
    result.parseError = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  /* Check if it's an object (not an array or primitive) */
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    result.parseError = `Expected a JSON object but got ${Array.isArray(parsed) ? 'array' : typeof parsed}`;
    return result;
  }

  const schemaKeys = Object.keys(schemaToUse);
  const parsedKeys = Object.keys(parsed);

  /* Detect unexpected (extra) fields not in the schema */
  result.unexpectedFields = parsedKeys.filter((k) => !schemaKeys.includes(k));

  /* Validate each expected field */
  for (const [fieldName, fieldDef] of Object.entries(schemaToUse) as [string, LegacySchemaFieldDef][]) {
    const fieldResult: ValidationFieldResult & { present: boolean; value: unknown } = {
      field: fieldName,
      label: fieldDef.label,
      required: fieldDef.required,
      expectedType: fieldDef.type,
      present: fieldName in parsed,
      value: parsed[fieldName] ?? null,
      status: 'pass',
      issues: [] as string[],
    };

    result.summary.total++;

    /* Check presence */
    if (!fieldResult.present || fieldResult.value === null || fieldResult.value === undefined) {
      if (fieldDef.required) {
        fieldResult.status = 'error';
        fieldResult.issues.push('Required field is missing or null');
        result.summary.errors++;
      } else {
        fieldResult.status = 'warning';
        fieldResult.issues.push('Field is missing or null (optional)');
        result.summary.missing++;
      }
      result.fields.push(fieldResult);
      continue;
    }

    /* Type check: multi fields should be arrays, single fields should be strings */
    const val = fieldResult.value;

    if (fieldDef.type === 'multi') {
      if (!Array.isArray(val)) {
        /* Accept semicolon-separated strings as well */
        if (typeof val === 'string') {
          fieldResult.issues.push('Expected array but got string (semicolon-separated may be acceptable)');
          fieldResult.status = 'warning';
          result.summary.warnings++;
          /* Still validate allowed values by splitting */
          if (fieldDef.allowedValues) {
            const allowed = fieldDef.allowedValues;
            const parts = val.split(';').map((s) => s.trim());
            const invalid = parts.filter((p) => p && !allowed.includes(p));
            if (invalid.length > 0) {
              fieldResult.issues.push(`Non-allowed values: ${invalid.join(', ')}`);
              fieldResult.status = 'error';
              result.summary.errors++;
              result.summary.warnings--; /* upgrade from warning to error */
            }
          }
          result.fields.push(fieldResult);
          continue;
        } else {
          fieldResult.status = 'error';
          fieldResult.issues.push(`Expected array but got ${typeof val}`);
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Validate allowed values for array items */
      if (fieldDef.allowedValues) {
        const allowed = fieldDef.allowedValues;
        const invalid = val.filter((v) => typeof v === 'string' && !allowed.includes(v));
        if (invalid.length > 0) {
          fieldResult.issues.push(`Non-allowed values: ${invalid.join(', ')}`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Check if suggested values — flag non-standard but don't mark as error */
      if (fieldDef.suggestedValues && Array.isArray(val)) {
        const suggested = fieldDef.suggestedValues;
        const nonStandard = val.filter((v) => typeof v === 'string' && !suggested.includes(v));
        if (nonStandard.length > 0) {
          fieldResult.issues.push(`Custom values (not in suggested list): ${nonStandard.join(', ')}`);
          /* Custom values are acceptable for these fields, so keep as pass */
        }
      }
    } else if (fieldDef.type === 'single') {
      if (typeof val !== 'string' && typeof val !== 'number') {
        /* Arrays are not acceptable for single-value fields */
        if (Array.isArray(val)) {
          fieldResult.issues.push('Expected single value but got array');
          fieldResult.status = 'warning';
          result.summary.warnings++;
        } else {
          fieldResult.issues.push(`Expected string but got ${typeof val}`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }

      /* Validate against allowed values */
      if (fieldDef.allowedValues && typeof val === 'string') {
        if (!fieldDef.allowedValues.includes(val)) {
          fieldResult.issues.push(`Value "${val}" not in allowed list`);
          fieldResult.status = 'error';
          result.summary.errors++;
          result.fields.push(fieldResult);
          continue;
        }
      }
    }

    if (fieldResult.status === 'pass') {
      result.summary.passed++;
    }
    result.fields.push(fieldResult);
  }

  result.valid = result.summary.errors === 0 && !result.parseError;
  return result;
}
