/**
 * Deterministic JSON contract validators for the formatting-rules engine.
 */

import { trimToOnlyJson } from './rules/json.ts';

interface VerificationFailure {
  verified: false;
  reason: 'not_json' | 'missing_keys' | 'type_mismatch' | 'enum_violation';
  details?: string;
  partial?: Record<string, unknown>;
}

function verificationFailureJson(failure: VerificationFailure): string {
  return JSON.stringify(failure);
}

/** Parse text as JSON object; return null on failure. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through to trim-to-json extraction */
  }
  try {
    const extracted = trimToOnlyJson(text);
    const parsed = JSON.parse(extracted);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* not parseable */
  }
  return null;
}

/**
 * Assert listed top-level keys are present and non-empty.
 * Options: { keys: string[] } or { expectedKeys: string[] }
 */
function requireKeys(text: string, options: Record<string, unknown> = {}): string {
  const keys = (Array.isArray(options.keys) ? options.keys : options.expectedKeys) as string[] | undefined;
  if (!keys || keys.length === 0) return text;

  const parsed = parseJsonObject(text);
  if (!parsed) {
    return verificationFailureJson({ verified: false, reason: 'not_json', details: 'Response is not parseable JSON' });
  }

  const missing = keys.filter((k) => {
    const v = parsed[k];
    if (v === undefined || v === null) return true;
    if (typeof v === 'string' && v.trim() === '') return true;
    return false;
  });

  if (missing.length > 0) {
    return verificationFailureJson({
      verified: false,
      reason: 'missing_keys',
      details: `Missing or empty keys: ${missing.join(', ')}`,
      partial: parsed,
    });
  }

  return JSON.stringify(parsed);
}

type FlatSchemaField = { type?: string; required?: boolean; enum?: string[] };

/**
 * Validate against a declared flat schema.
 * Options: { schema: Record<string, FlatSchemaField | string> }
 * Field shorthand: { score: 'number', status: { type: 'string', enum: ['a','b'] } }
 */
function assertJsonSchema(text: string, options: Record<string, unknown> = {}): string {
  const schema = options.schema as Record<string, FlatSchemaField | string> | undefined;
  if (!schema || typeof schema !== 'object') return text;

  const parsed = parseJsonObject(text);
  if (!parsed) {
    return verificationFailureJson({ verified: false, reason: 'not_json', details: 'Response is not parseable JSON' });
  }

  for (const [field, spec] of Object.entries(schema)) {
    const fieldSpec: FlatSchemaField = typeof spec === 'string' ? { type: spec, required: true } : spec;
    const value = parsed[field];

    if (fieldSpec.required !== false && (value === undefined || value === null)) {
      return verificationFailureJson({
        verified: false,
        reason: 'missing_keys',
        details: `Required field missing: ${field}`,
        partial: parsed,
      });
    }

    if (value === undefined || value === null) continue;

    const expectedType = fieldSpec.type;
    if (expectedType) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== expectedType) {
        return verificationFailureJson({
          verified: false,
          reason: 'type_mismatch',
          details: `Field "${field}" expected ${expectedType}, got ${actualType}`,
          partial: parsed,
        });
      }
    }

    if (fieldSpec.enum && Array.isArray(fieldSpec.enum)) {
      const strVal = String(value);
      if (!fieldSpec.enum.includes(strVal)) {
        return verificationFailureJson({
          verified: false,
          reason: 'enum_violation',
          details: `Field "${field}" value "${strVal}" not in [${fieldSpec.enum.join(', ')}]`,
          partial: parsed,
        });
      }
    }
  }

  return JSON.stringify(parsed);
}

/**
 * Coerce top-level field types (string→number, string→boolean).
 * Options: { fields: Record<string, 'number'|'boolean'|'string'> }
 */
function coerceTypes(text: string, options: Record<string, unknown> = {}): string {
  const fields = options.fields as Record<string, string> | undefined;
  if (!fields || typeof fields !== 'object') return text;

  const parsed = parseJsonObject(text);
  if (!parsed) {
    return verificationFailureJson({ verified: false, reason: 'not_json', details: 'Response is not parseable JSON' });
  }

  for (const [field, targetType] of Object.entries(fields)) {
    const value = parsed[field];
    if (value === undefined || value === null) continue;

    try {
      if (targetType === 'number') {
        const num = typeof value === 'number' ? value : Number(value);
        if (Number.isNaN(num)) {
          return verificationFailureJson({
            verified: false,
            reason: 'type_mismatch',
            details: `Cannot coerce "${field}" to number`,
            partial: parsed,
          });
        }
        parsed[field] = num;
      } else if (targetType === 'boolean') {
        if (typeof value === 'boolean') continue;
        const lower = String(value).toLowerCase();
        if (lower === 'true') parsed[field] = true;
        else if (lower === 'false') parsed[field] = false;
        else {
          return verificationFailureJson({
            verified: false,
            reason: 'type_mismatch',
            details: `Cannot coerce "${field}" to boolean`,
            partial: parsed,
          });
        }
      } else if (targetType === 'string') {
        parsed[field] = String(value);
      }
    } catch {
      return verificationFailureJson({
        verified: false,
        reason: 'type_mismatch',
        details: `Coercion failed for "${field}"`,
        partial: parsed,
      });
    }
  }

  return JSON.stringify(parsed);
}

/**
 * Clamp a field value to an allowed enum set.
 * Options: { field: string, allowed: string[] } or { constraints: Record<string, string[]> }
 */
function constrainEnum(text: string, options: Record<string, unknown> = {}): string {
  const constraints: Record<string, string[]> = {};

  if (typeof options.field === 'string' && Array.isArray(options.allowed)) {
    constraints[options.field] = options.allowed as string[];
  }
  if (options.constraints && typeof options.constraints === 'object') {
    Object.assign(constraints, options.constraints);
  }

  if (Object.keys(constraints).length === 0) return text;

  const parsed = parseJsonObject(text);
  if (!parsed) {
    return verificationFailureJson({ verified: false, reason: 'not_json', details: 'Response is not parseable JSON' });
  }

  for (const [field, allowed] of Object.entries(constraints)) {
    const value = parsed[field];
    if (value === undefined || value === null) continue;
    const strVal = String(value);
    if (!allowed.includes(strVal)) {
      return verificationFailureJson({
        verified: false,
        reason: 'enum_violation',
        details: `Field "${field}" value "${strVal}" not in [${allowed.join(', ')}]`,
        partial: parsed,
      });
    }
  }

  return JSON.stringify(parsed);
}

export { requireKeys, assertJsonSchema, coerceTypes, constrainEnum };
