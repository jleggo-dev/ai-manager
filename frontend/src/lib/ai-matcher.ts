/**
 * Pure helpers for the AI Matcher page.
 * Extracted from AiMatcherPage.tsx (FE-03) so schema validation and slot
 * payload shaping stay unit-testable without a React tree.
 */

import { interpolateTemplate } from './interpolate';
import { DEFAULT_RUNTIME_OPTIONS } from './runtime-options';
import type { AiMatcherSlotResult, ExpectedSchema, SchemaFieldDef } from '../types/api';

export interface RuntimeOptions {
  devs_ai?: {
    built_in_tools?: string[];
    [key: string]: unknown;
  };
  google_gemini?: {
    grounding_with_google_search?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SlotConfig {
  source: string;
  profileId: string;
  providerId: string;
  profileType: string;
  externalAiId: string;
  runtimeOptions: RuntimeOptions;
}

export interface NormalisedField {
  label: string;
  type: 'multi' | 'single';
  required: boolean;
}

export interface SchemaValidationResult {
  valid: boolean;
  parseError: string | null;
  summary: { total: number; passed: number; errors: number };
}

export type MatcherSlotPayload =
  | { type: 'profile'; profileId: string }
  | {
      type: 'adhoc';
      providerId: string;
      externalAiId: string;
      profileType: string;
      mode: string;
      runtimeOptions: RuntimeOptions;
    };

export const SLOT_COLORS = ['blue', 'green', 'orange', 'violet'] as const;
export const SLOT_LABELS = ['A', 'B', 'C', 'D'] as const;

export function emptySlot(): SlotConfig {
  return {
    source: 'profile',
    profileId: '',
    providerId: '',
    profileType: 'model',
    externalAiId: '',
    runtimeOptions: { ...DEFAULT_RUNTIME_OPTIONS } as RuntimeOptions,
  };
}

/** Compose a prompt via the canonical interpolator (replaces inline {{var}} regex). */
export function composeMatcherPrompt(template: string, vars: Record<string, string>): string {
  return interpolateTemplate(template, vars).text;
}

export function isSlotConfigured(slot: SlotConfig): boolean {
  if (slot.source === 'profile') return !!slot.profileId;
  return !!slot.providerId && !!slot.externalAiId;
}

export function toMatcherSlotPayload(slot: SlotConfig): MatcherSlotPayload {
  if (slot.source === 'profile') {
    return { type: 'profile', profileId: slot.profileId };
  }
  return {
    type: 'adhoc',
    providerId: slot.providerId,
    externalAiId: slot.externalAiId,
    profileType: slot.profileType,
    mode: 'completion',
    runtimeOptions: slot.runtimeOptions,
  };
}

export function normaliseSchemaFields(schema: ExpectedSchema): Record<string, NormalisedField> {
  const fields = schema?.fields || {};
  const normalised: Record<string, NormalisedField> = {};
  for (const [name, def] of Object.entries(fields) as [string, SchemaFieldDef][]) {
    normalised[name] = {
      label: def.description || name,
      type: def.type === 'array' ? 'multi' : 'single',
      required: !!def.required,
    };
  }
  return normalised;
}

export function validateSchema(formattedText: string, expectedSchema: ExpectedSchema): SchemaValidationResult | null {
  const result: SchemaValidationResult = {
    valid: false,
    parseError: null,
    summary: { total: 0, passed: 0, errors: 0 },
  };
  if (!expectedSchema || !Object.keys(expectedSchema.fields || {}).length) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(formattedText);
  } catch (err) {
    result.parseError = `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    result.parseError = `Expected JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`;
    return result;
  }

  const schema = normaliseSchemaFields(expectedSchema);
  for (const [fieldName, def] of Object.entries(schema)) {
    result.summary.total++;
    const present = fieldName in parsed && parsed[fieldName] !== null && parsed[fieldName] !== undefined;
    const val = parsed[fieldName];
    const isEmpty = present && (val === '' || (Array.isArray(val) && val.length === 0));
    if (present && !isEmpty) {
      result.summary.passed++;
    } else if (def.required) {
      result.summary.errors++;
    }
  }
  result.valid = result.summary.errors === 0 && !result.parseError;
  return result;
}

export function fastestSuccessDuration(results: (AiMatcherSlotResult | null)[]): number | null {
  const successResults = results.filter((r): r is AiMatcherSlotResult => r !== null && r.status === 'success');
  if (successResults.length === 0) return null;
  return Math.min(...successResults.map((r) => r.durationMs ?? Infinity));
}
