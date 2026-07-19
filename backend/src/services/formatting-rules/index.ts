/**
 * Service – Formatting Rules Engine
 * -----------------------------------
 * Applies a chain of text transformation rules to AI responses.
 * Each rule is a pure function: (text, options?) → text.
 *
 * Rules are stored as JSON in the processing_jobs.config.formattingRules array:
 *   [{ "type": "remove-reasoning", "order": 0 }, { "type": "trim-to-json", "order": 1 }]
 */

import type { FormattingRule, FormattingResult, FormattingStep } from '../../types.ts';
import { errorMessage } from '../../lib/error-message.ts';
import { removeReasoning, removeFootnoteTags, removeCustomTags, extractBetweenTags } from './rules/strip-tags.ts';
import { trimLeadingSpaces, trimTrailingSpaces, trimLeadingLineBreaks, trimTrailingPeriod } from './rules/trim.ts';
import { trimToOnlyCsv, convertCsvToJson, repairBrokenCsv } from './rules/csv.ts';
import { trimToOnlyJson, repairBrokenJson } from './rules/json.ts';
import { convertToUppercase, convertToLowercase, convertToSentenceCase } from './rules/case.ts';
import { requireKeys, assertJsonSchema, coerceTypes, constrainEnum } from './validators.ts';

export interface RuleEntry {
  fn: (text: string, options?: Record<string, unknown>) => string;
  label: string;
  description: string;
  hasOptions?: boolean;
  streamingSafe: boolean;
  streamingNote: string;
}

/* ── Rule Registry ────────────────────────────────────────────── */

export const RULE_REGISTRY: Record<string, RuleEntry> = {
  'remove-reasoning': {
    fn: removeReasoning,
    label: 'Remove Reasoning',
    description: 'Removes everything between <think></think> tags including the tags themselves.',
    streamingSafe: true,
    streamingNote: 'Applied in real time during streaming and to stored content.',
  },
  'remove-footnote-tags': {
    fn: removeFootnoteTags,
    label: 'Remove Footnote Tags',
    description: 'Removes footnote reference tags like <#1#>, <#3#>, <#15#>, etc.',
    streamingSafe: true,
    streamingNote: 'Applied in real time during streaming and to stored content.',
  },
  'remove-custom-tags': {
    fn: removeCustomTags,
    label: 'Remove Custom Tags',
    description: 'Removes content between custom tags. Specify the tag name.',
    hasOptions: true,
    streamingSafe: false,
    streamingNote:
      'Requires full response. Tags may span multiple chunks. Applied post-stream to stored content, workflow variables, and the formatted_response event.',
  },
  'extract-between-tags': {
    fn: extractBetweenTags,
    label: 'Extract Between Tags',
    description: 'Captures only the content between specified tags. Everything else is removed.',
    hasOptions: true,
    streamingSafe: false,
    streamingNote:
      'Requires full response. Applied post-stream to stored content, workflow variables, and the formatted_response event.',
  },
  'trim-leading-spaces': {
    fn: trimLeadingSpaces,
    label: 'Trim Leading Spaces',
    description: 'Removes all leading spaces from each line.',
    streamingSafe: false,
    streamingNote: 'Applied post-stream to the complete response for consistency.',
  },
  'trim-trailing-spaces': {
    fn: trimTrailingSpaces,
    label: 'Trim Trailing Spaces',
    description: 'Removes all trailing spaces from each line.',
    streamingSafe: false,
    streamingNote: 'Applied post-stream to the complete response for consistency.',
  },
  'trim-leading-linebreaks': {
    fn: trimLeadingLineBreaks,
    label: 'Trim Leading Line Breaks',
    description: 'Removes all leading line breaks from the beginning of the text.',
    streamingSafe: false,
    streamingNote: 'Applied post-stream to the complete response.',
  },
  'trim-trailing-period': {
    fn: trimTrailingPeriod,
    label: 'Trim Trailing Period',
    description: 'Removes a trailing period at the end of the response if present.',
    streamingSafe: false,
    streamingNote: 'Applied post-stream to the complete response.',
  },
  'trim-to-csv': {
    fn: trimToOnlyCsv,
    label: 'Trim to Only CSV',
    description: 'Isolates CSV formatted content and removes any leading or trailing non-CSV text.',
    streamingSafe: false,
    streamingNote:
      'Requires full response. Applied post-stream to stored content, workflow variables, and the formatted_response event.',
  },
  'trim-to-json': {
    fn: trimToOnlyJson,
    label: 'Trim to Only JSON',
    description: 'Isolates JSON formatted content and removes any leading or trailing non-JSON text.',
    hasOptions: true,
    streamingSafe: false,
    streamingNote:
      'Requires full response. Applied post-stream to stored content, workflow variables, and the formatted_response event. In workflows, uses output mappings to identify the correct JSON block.',
  },
  uppercase: {
    fn: convertToUppercase,
    label: 'Convert to UPPERCASE',
    description: 'Converts all text to uppercase letters.',
    streamingSafe: false,
    streamingNote: 'Applied post-stream to the complete response for consistency.',
  },
  lowercase: {
    fn: convertToLowercase,
    label: 'Convert to lowercase',
    description: 'Converts all text to lowercase letters.',
    streamingSafe: false,
    streamingNote: 'Applied post-stream to the complete response for consistency.',
  },
  'sentence-case': {
    fn: convertToSentenceCase,
    label: 'Convert to Sentence Case',
    description: 'Capitalizes the first letter of each sentence and makes the rest lowercase.',
    streamingSafe: false,
    streamingNote: 'Applied post-stream to the complete response for consistency.',
  },
  'csv-to-json': {
    fn: convertCsvToJson,
    label: 'Convert CSV to JSON',
    description: 'Converts CSV response to JSON format.',
    streamingSafe: false,
    streamingNote:
      'Requires full response. Applied post-stream to stored content, workflow variables, and the formatted_response event.',
  },
  'repair-json': {
    fn: repairBrokenJson,
    label: 'Repair Broken JSON',
    description:
      'Repairs broken JSON from LLM output: truncated responses (token limit), unterminated strings, trailing commas, unmatched braces, markdown fences, JS literals (NaN/undefined), and control characters.',
    streamingSafe: false,
    streamingNote:
      'Requires full response. Repairs broken JSON after the stream completes. Applied to stored content and the formatted_response event.',
  },
  'repair-csv': {
    fn: repairBrokenCsv,
    label: 'Repair Broken CSV',
    description: 'Attempts to repair broken CSV (unmatched quotes, line breaks in fields).',
    streamingSafe: false,
    streamingNote: 'Requires full response. Applied post-stream to stored content and the formatted_response event.',
  },
  'require-keys': {
    fn: requireKeys,
    label: 'Require Keys',
    description:
      'Assert listed top-level JSON keys are present and non-empty. On failure emits { verified: false, reason: "missing_keys" }.',
    hasOptions: true,
    streamingSafe: false,
    streamingNote: 'Requires full JSON. Applied post-stream. Use after trim-to-json and repair-json.',
  },
  'assert-json-schema': {
    fn: assertJsonSchema,
    label: 'Assert JSON Schema',
    description:
      'Validate response against a flat schema (types, required fields, enums). On failure emits { verified: false, reason: ... }.',
    hasOptions: true,
    streamingSafe: false,
    streamingNote: 'Requires full JSON. Applied post-stream. Deterministic contract check — no LLM verifier needed.',
  },
  'coerce-types': {
    fn: coerceTypes,
    label: 'Coerce Types',
    description:
      'Normalize top-level field types (string→number, string→boolean). On failure emits { verified: false }.',
    hasOptions: true,
    streamingSafe: false,
    streamingNote: 'Requires full JSON. Applied post-stream after trim-to-json.',
  },
  'constrain-enum': {
    fn: constrainEnum,
    label: 'Constrain Enum',
    description:
      'Assert field values are in an allowed set. On failure emits { verified: false, reason: "enum_violation" }.',
    hasOptions: true,
    streamingSafe: false,
    streamingNote: 'Requires full JSON. Applied post-stream.',
  },
};

/* ── Public API ──────────────────────────────────────────────── */

/**
 * Get the list of all available formatting rules (for the UI).
 */
export function listAvailableRules(): Array<{
  type: string;
  label: string;
  description: string;
  hasOptions: boolean;
  streamingSafe: boolean;
  streamingNote: string;
}> {
  return Object.entries(RULE_REGISTRY).map(([type, rule]) => ({
    type,
    label: rule.label,
    description: rule.description,
    hasOptions: !!rule.hasOptions,
    streamingSafe: rule.streamingSafe,
    streamingNote: rule.streamingNote,
  }));
}

/**
 * Apply a chain of formatting rules to a text string.
 *
 * @param text   — raw AI response text
 * @param rules  — [{ type: string, options?: object }] in order
 */
export function applyFormattingRules(text: string, rules: FormattingRule[] = []): FormattingResult {
  const steps: FormattingStep[] = [];
  let current = text;

  /* Sort rules by their `order` field if present */
  const sorted = [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  for (const rule of sorted) {
    const entry = RULE_REGISTRY[rule.type];
    if (!entry) {
      steps.push({ type: rule.type, error: 'Unknown rule type', before: current.length, after: current.length });
      continue;
    }

    const before = current;
    try {
      const result = entry.fn(current, rule.options || {});

      /* Rollback guard: if a step removed >90% of content and the result
         is trivially small, the step likely destroyed the real content.
         Roll back and flag a warning so downstream steps work with the
         original text instead. */
      const shrinkRatio = before.length > 0 ? result.length / before.length : 1;
      const CATASTROPHIC_THRESHOLD = 50;
      if (shrinkRatio < 0.1 && result.length < CATASTROPHIC_THRESHOLD && before.length > CATASTROPHIC_THRESHOLD) {
        steps.push({
          type: rule.type,
          label: entry.label,
          before: before.length,
          after: before.length,
          changed: false,
          rolledBack: true,
          warning: `Step reduced content from ${before.length} to ${result.length} chars — rolled back to preserve data.`,
        });
      } else {
        current = result;
        steps.push({
          type: rule.type,
          label: entry.label,
          before: before.length,
          after: current.length,
          changed: before !== current,
        });
      }
    } catch (err: unknown) {
      steps.push({
        type: rule.type,
        label: entry.label,
        error: errorMessage(err),
        before: before.length,
        after: before.length,
      });
    }
  }

  return { formatted: current, steps };
}
