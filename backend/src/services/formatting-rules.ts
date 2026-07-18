/**
 * Service – Formatting Rules Engine
 * -----------------------------------
 * Applies a chain of text transformation rules to AI responses.
 * Each rule is a pure function: (text, options?) → text.
 *
 * Rules are stored as JSON in the processing_jobs.config.formattingRules array:
 *   [{ "type": "remove-reasoning", "order": 0 }, { "type": "trim-to-json", "order": 1 }]
 */

import type { FormattingRule, FormattingResult, FormattingStep } from '../types.ts';
import { errorMessage } from '../lib/error-message.ts';

export interface RuleEntry {
  fn: (text: string, options?: Record<string, unknown>) => string;
  label: string;
  description: string;
  hasOptions?: boolean;
  streamingSafe: boolean;
  streamingNote: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── Rule Implementations ─────────────────────────────────────── */

/** Remove everything between <think></think> tags (including the tags).
 *  Also strips free-text reasoning that precedes a JSON code block. */
function removeReasoning(text: string): string {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  /* Many models write reasoning as plain text before a ```json block.
     If a markdown-fenced JSON block exists, discard everything before it. */
  const fenceMatch = cleaned.match(/^[\s\S]*?(```(?:json)?\s*\n[\s\S]*?```)/im);
  const fenced = fenceMatch?.[1];
  if (fenced) {
    cleaned = fenced.trim();
  }

  return cleaned;
}

/** Remove footnote reference tags like <#1#>, <#3#>, <#15#>. */
function removeFootnoteTags(text: string): string {
  return text.replace(/<#\d+#>/g, '');
}

/** Remove content between custom tags. Options: { tagName: string } */
function removeCustomTags(text: string, options: Record<string, unknown> = {}): string {
  const tag = (options.tagName || options.tag) as string | undefined;
  if (!tag) return text;
  const regex = new RegExp(`<${escapeRegex(tag)}>[\\s\\S]*?<\\/${escapeRegex(tag)}>`, 'gi');
  return text.replace(regex, '').trim();
}

/** Keep only the content between specified tags. Options: { tagName: string } */
function extractBetweenTags(text: string, options: Record<string, unknown> = {}): string {
  const tag = (options.tagName || options.tag) as string | undefined;
  if (!tag) return text;
  const regex = new RegExp(`<${escapeRegex(tag)}>([\\s\\S]*?)<\\/${escapeRegex(tag)}>`, 'gi');
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1] ?? '');
  }
  return matches.length > 0 ? matches.join('\n').trim() : text;
}

/** Remove all leading spaces from each line. */
function trimLeadingSpaces(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .join('\n');
}

/** Remove all trailing spaces from each line. */
function trimTrailingSpaces(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');
}

/** Remove all leading line breaks from the beginning of the text. */
function trimLeadingLineBreaks(text: string): string {
  return text.replace(/^[\r\n]+/, '');
}

/** Remove a trailing period at the end of the response if present. */
function trimTrailingPeriod(text: string): string {
  return text.replace(/\.\s*$/, '').trim();
}

/** Isolate CSV formatted content — remove non-CSV text before/after. */
function trimToOnlyCsv(text: string): string {
  /* Look for lines that contain commas in a tabular pattern */
  const lines = text.split('\n');
  const csvLines: string[] = [];
  let inCsv = false;

  for (const line of lines) {
    const trimmed = line.trim();
    /* A CSV line typically has commas and may be quoted */
    if (trimmed.includes(',') && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
      inCsv = true;
      csvLines.push(trimmed);
    } else if (inCsv && trimmed === '') {
      /* Allow blank lines within CSV */
      csvLines.push('');
    } else if (inCsv && !trimmed.includes(',')) {
      /* End of CSV block */
      break;
    }
  }

  return csvLines.join('\n').trim() || text;
}

/**
 * Isolate JSON content — extract the best valid JSON object or array.
 *
 * When `expectedKeys` is provided and multiple JSON candidates exist,
 * prefer the candidate whose top-level keys best match the expected set.
 * This disambiguates responses that contain several JSON blocks.
 */
function trimToOnlyJson(text: string, options: Record<string, unknown> = {}): string {
  const expectedKeys = Array.isArray(options.expectedKeys) ? (options.expectedKeys as string[]) : null;

  /* Strip markdown fences first */
  let cleaned = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/m, '')
    .trim();

  /* Fast path: already valid JSON after fence stripping */
  try {
    const parsed = JSON.parse(cleaned);
    if (!expectedKeys || !Array.isArray(expectedKeys) || expectedKeys.length === 0) return cleaned;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const score = expectedKeys.filter((k) => k in parsed).length;
      if (score > 0) return cleaned;
    }
    /* Has expectedKeys but the fast-path JSON doesn't match — continue scanning */
  } catch {
    /* needs extraction */
  }

  interface JsonCandidate {
    text: string;
    valid: boolean;
    score: number;
  }

  const candidates: JsonCandidate[] = [];
  let searchFrom = 0;
  let longestCandidate: string | null = null;

  while (searchFrom < cleaned.length) {
    const remaining = cleaned.slice(searchFrom);
    const relStart = remaining.search(/[{[]/);
    if (relStart === -1) break;

    const jsonStart = searchFrom + relStart;
    const startChar = cleaned[jsonStart];
    const endChar = startChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    let matchEnd = -1;

    for (let i = jsonStart; i < cleaned.length; i++) {
      const ch = cleaned[i];

      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === startChar) depth++;
      if (ch === endChar) depth--;

      if (depth === 0) {
        matchEnd = i;
        break;
      }
    }

    if (matchEnd === -1) {
      const unclosed = cleaned.slice(jsonStart);
      if (!longestCandidate || unclosed.length > longestCandidate.length) {
        longestCandidate = unclosed;
      }
      break;
    }

    const candidate = cleaned.slice(jsonStart, matchEnd + 1);
    let score = 0;

    try {
      const parsed = JSON.parse(candidate);

      if (expectedKeys && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        score = expectedKeys.filter((k) => k in parsed).length;
      }

      /* No expectedKeys — return the first valid candidate (original behavior) */
      if (!expectedKeys) return candidate;

      candidates.push({ text: candidate, valid: true, score });
    } catch {
      if (!longestCandidate || candidate.length > longestCandidate.length) {
        longestCandidate = candidate;
      }
      candidates.push({ text: candidate, valid: false, score: 0 });
    }

    searchFrom = matchEnd + 1;
  }

  if (expectedKeys && candidates.length > 0) {
    /* Prefer valid candidates with the highest key-match score, then longest */
    const best = candidates
      .filter((c) => c.valid)
      .sort((a, b) => b.score - a.score || b.text.length - a.text.length)[0];
    if (best) return best.text;

    /* No valid candidate — return longest unparsed (repair step will handle it) */
    const longestUnparsed = candidates.sort((a, b) => b.text.length - a.text.length)[0];
    if (longestUnparsed) return longestUnparsed.text;
  }

  return longestCandidate || text;
}

/** Convert all text to UPPERCASE. */
function convertToUppercase(text: string): string {
  return text.toUpperCase();
}

/** Convert all text to lowercase. */
function convertToLowercase(text: string): string {
  return text.toLowerCase();
}

/** Capitalise the first letter of each sentence. */
function convertToSentenceCase(text: string): string {
  return text.replace(/(^\s*\w|[.!?]\s+\w)/gm, (match) => match.toUpperCase());
}

/** Convert CSV text to JSON. */
function convertCsvToJson(text: string): string {
  try {
    const lines = text
      .trim()
      .split('\n')
      .filter((l) => l.trim());
    if (lines.length < 2) return text;

    const headers = parseCsvLine(lines[0] ?? '');
    const rows = lines.slice(1).map((line) => {
      const values = parseCsvLine(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h.trim()] = (values[i] || '').trim();
      });
      return obj;
    });

    return JSON.stringify(rows, null, 2);
  } catch {
    return text;
  }
}

/** Simple CSV line parser that handles quoted fields. */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Attempt to repair broken JSON from LLM output.
 *
 * Handles common LLM malformations:
 *   1. Truncated output (token limit hit) — mid-string, mid-value, mid-object
 *   2. Trailing commas before } or ]
 *   3. Unmatched braces / brackets
 *   4. Single-line comments (// ...)
 *   5. Markdown code fences around JSON
 *   6. Single quotes instead of double quotes (outside of string values)
 *   7. Unquoted keys (e.g. { name: "value" })
 *   8. NaN, Infinity, undefined literals
 *   9. Control characters inside strings
 *  10. Concatenated JSON objects (missing comma between array elements)
 */
function repairBrokenJson(text: string): string {
  /* Fast path: already valid JSON */
  try {
    JSON.parse(text);
    return text;
  } catch {
    /* needs repair */
  }

  let repaired = text.trim();

  /* ── Phase 1: Clean surrounding noise ──────────────────────── */

  /* Strip markdown fences */
  repaired = repaired
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/m, '')
    .trim();

  /* Remove single-line comments (outside strings — crude but effective) */
  repaired = repaired.replace(/^\s*\/\/[^\n]*/gm, '');

  /* Replace JavaScript-style literals that aren't valid JSON */
  repaired = repaired.replace(/\bNaN\b/g, 'null');
  repaired = repaired.replace(/\bInfinity\b/g, 'null');
  repaired = repaired.replace(/\bundefined\b/g, 'null');

  /* Remove control characters (except \n, \r, \t which are handled by JSON) */
  // eslint-disable-next-line no-control-regex
  repaired = repaired.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

  /* Quick check after basic cleanup */
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    /* continue with deeper repair */
  }

  /* ── Phase 2: State-machine walk to find truncation point ──── */
  repaired = repairTruncatedJson(repaired);

  /* ── Phase 3: Trailing comma cleanup (applied after truncation repair) */
  repaired = removeTrailingCommas(repaired);

  /* ── Phase 4: Verify result ────────────────────────────────── */
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    /* Phase 5: Aggressive fallback — try removing the last incomplete element */
    const aggressive = aggressiveTruncationRepair(repaired);
    try {
      JSON.parse(aggressive);
      return aggressive;
    } catch {
      /* Return the best attempt — downstream code will report the parse error */
      return repaired;
    }
  }
}

/**
 * Walk through the JSON string with a state machine, tracking whether
 * we're inside a string, which braces/brackets are open, and where
 * the truncation occurred. Then close everything properly.
 */
function repairTruncatedJson(text: string): string {
  /* Find the JSON start */
  const jsonStart = text.search(/[{[]/);
  if (jsonStart === -1) return text;

  const prefix = text.slice(0, jsonStart);
  const json = text.slice(jsonStart);

  let inString = false;
  let escape = false;
  /** Stack of open structural characters: '{' or '[' */
  const stack: string[] = [];
  /** Position of the last complete value boundary (after a comma, colon, or bracket) */
  let lastSafePos = 0;
  /** Whether we just finished a complete key:value pair or array element */
  let afterValue = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
        afterValue = true;
      }
      /* Any other character inside a string — just continue */
      continue;
    }

    /* Outside a string */
    switch (ch) {
      case '"':
        inString = true;
        afterValue = false;
        break;
      case '{':
      case '[':
        stack.push(ch);
        afterValue = false;
        break;
      case '}':
        stack.pop();
        afterValue = true;
        if (stack.length === 0) {
          /* Found complete JSON — return it */
          return prefix + json.slice(0, i + 1);
        }
        lastSafePos = i + 1;
        break;
      case ']':
        stack.pop();
        afterValue = true;
        if (stack.length === 0) {
          return prefix + json.slice(0, i + 1);
        }
        lastSafePos = i + 1;
        break;
      case ',':
        if (afterValue) {
          lastSafePos = i + 1;
        }
        afterValue = false;
        break;
      case ':':
        afterValue = false;
        break;
      default:
        /* Whitespace, numbers, true/false/null literals */
        if (ch != null && (/[0-9.eE+-]/.test(ch) || /[tfn]/.test(ch))) {
          afterValue = true;
        }
        break;
    }
  }

  /* ── We reached the end without closing all brackets ─────── */
  /* This means the JSON was truncated. */

  let result: string;

  if (inString) {
    /* Truncated inside a string — close the string.
       Then try to close from the last safe position first (removing the
       incomplete key-value pair), and if that doesn't work, close from here. */
    const truncatedAt = json.length;

    /* Strategy A: Close the string, remove any trailing incomplete key:value,
       then close all open brackets. */
    let attempt = json.slice(0, truncatedAt) + '"';

    /* If the open string was a value (after a colon), close the object/array.
       If it was a key (before a colon), we need to remove the orphan key. */
    attempt = cleanTrailingFragment(attempt);
    attempt = closeOpenBrackets(attempt, stack);
    result = prefix + attempt;

    try {
      JSON.parse(result);
      return result;
    } catch {
      /* Strategy B: Cut back to the last safe position and close brackets */
      if (lastSafePos > 0) {
        let cutback = json.slice(0, lastSafePos);
        cutback = cleanTrailingFragment(cutback);
        cutback = closeOpenBrackets(cutback, stack);
        result = prefix + cutback;
        try {
          JSON.parse(result);
          return result;
        } catch {
          /* fall through */
        }
      }
    }
  } else {
    /* Not inside a string but still unclosed brackets.
       Cut back to last safe position if available. */
    if (lastSafePos > 0) {
      let cutback = json.slice(0, lastSafePos);
      cutback = cleanTrailingFragment(cutback);
      cutback = closeOpenBrackets(cutback, stack);
      result = prefix + cutback;
    } else {
      /* Just close what's open */
      let attempt = cleanTrailingFragment(json);
      attempt = closeOpenBrackets(attempt, stack);
      result = prefix + attempt;
    }
  }

  return result || prefix + json;
}

/**
 * Remove a trailing incomplete JSON fragment — e.g. an orphan key
 * without a value, a trailing comma, or an incomplete number.
 */
function cleanTrailingFragment(text: string): string {
  let cleaned = text.trimEnd();

  /* Remove trailing comma */
  cleaned = cleaned.replace(/,\s*$/, '');

  /* Remove trailing colon (orphan key without value — go back to remove the key too) */
  if (cleaned.endsWith(':')) {
    /* Remove `"key":` pattern at the end */
    cleaned = cleaned.replace(/,?\s*"[^"]*"\s*:\s*$/, '');
  }

  /* Remove trailing orphan key (quoted string after a comma at end of object) */
  cleaned = cleaned.replace(/,\s*"[^"]*"\s*$/, '');

  return cleaned;
}

/**
 * Close all open brackets/braces from a stack, producing the correct
 * closing sequence. Uses a state-machine recount for accuracy.
 */
function closeOpenBrackets(text: string, _hintStack: string[]): string {
  /* Recount the actual stack by walking the text (more reliable than
     the hint stack which may be stale after truncation surgery). */
  const stack: string[] = [];
  let inStr = false;
  let esc = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{' || ch === '[') stack.push(ch);
    if (ch === '}' || ch === ']') stack.pop();
  }

  /* If still inside a string after our repair, close it */
  if (inStr) text += '"';

  /* Close brackets in reverse order */
  let suffix = '';
  while (stack.length > 0) {
    const open = stack.pop();
    suffix += open === '{' ? '}' : ']';
  }

  return text + suffix;
}

/**
 * Remove trailing commas before } or ] throughout the JSON string.
 * Handles multiple occurrences and whitespace variations.
 */
function removeTrailingCommas(text: string): string {
  /* Iterative replacement since nested patterns may need multiple passes */
  let prev: string;
  let current = text;
  do {
    prev = current;
    current = current.replace(/,(\s*[}\]])/g, '$1');
  } while (current !== prev);
  return current;
}

/**
 * Aggressive fallback: if the normal repair didn't produce valid JSON,
 * try progressively removing the last array element or object property
 * until we get a valid parse.
 */
function aggressiveTruncationRepair(text: string): string {
  /* Find the last complete array element or object property by looking
     for the last },{  or },\n{  or ],  pattern and cutting there. */
  let best = text;

  /* Try removing content after the last complete array element ("},") */
  for (let attempts = 0; attempts < 5; attempts++) {
    /* Find the last occurrence of "}," or "]," that isn't inside a string */
    const lastObjComma = findLastStructuralComma(best);
    if (lastObjComma === -1) break;

    /* Cut everything after that comma and close */
    let candidate = best.slice(0, lastObjComma);
    candidate = cleanTrailingFragment(candidate);
    candidate = closeOpenBrackets(candidate, []);
    candidate = removeTrailingCommas(candidate);

    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      best = candidate;
    }
  }

  return text;
}

/**
 * Find the position of the last structural comma (one that separates
 * array elements or object properties) — not one inside a string.
 */
function findLastStructuralComma(text: string): number {
  let inStr = false;
  let esc = false;
  let lastComma = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === ',') lastComma = i;
  }

  return lastComma;
}

/** Attempt to repair broken CSV (unmatched quotes, line breaks in fields). */
function repairBrokenCsv(text: string): string {
  const lines = text.split('\n');
  const repaired: string[] = [];

  let buffer = '';
  for (const line of lines) {
    buffer += (buffer ? '\n' : '') + line;
    const quoteCount = (buffer.match(/"/g) || []).length;
    /* If quotes are balanced, this is a complete line */
    if (quoteCount % 2 === 0) {
      repaired.push(buffer);
      buffer = '';
    }
  }
  if (buffer) repaired.push(buffer);

  return repaired.join('\n');
}

/* ── Assertion helpers (deterministic contract validation) ─────── */

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
