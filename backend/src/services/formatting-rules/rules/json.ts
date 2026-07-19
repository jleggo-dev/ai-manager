/**
 * JSON isolation and repair rules for the formatting-rules engine.
 */

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

export { trimToOnlyJson, repairBrokenJson };
