# Extraction Schemas for `outputMappings`

This is the most AI-Admin-specific topic. `outputMappings` is the contract between workflow steps, and it has one hard constraint that dictates how you design every JSON schema.

## The one rule that changes everything: TOP-LEVEL KEYS ONLY

AI Admin parses the LLM's JSON response and maps **only top-level keys** to workflow variables. Nested paths (`result.score`, `options[0].title`) are **not** extractable — the entire nested value is stored as-is under one variable.

```json
// outputMappings
{ "score": "lead_score", "summary": "lead_summary" }
```

```json
// GOOD — flat top-level keys, each maps cleanly
{
  "score": 87,
  "summary": "Strong fit, enterprise budget confirmed."
}

// BAD — score is nested; "lead_score" would capture the whole object, not 87
{
  "analysis": { "score": 87, "summary": "..." }
}
```

**Design rule:** every field you reference in `outputMappings` must be a top-level key. If you need nested structure for a downstream step, either (a) flatten it to top-level keys, or (b) pass the whole object as one variable and parse it in the consuming step's prompt or in app code.

## Field names must match exactly

The JSON key and the `outputMappings` key must be identical (case-sensitive). Mismatch → empty variable at runtime, no error.

| Schema field | outputMappings key | Result |
|--------------|--------------------|--------|
| `"trusted_sources"` | `"trusted_sources"` | ✅ captured |
| `"trustedSources"` | `"trusted_sources"` | ❌ empty |

Pick one casing convention (snake_case is used across the example docs) and keep template, schema, and mappings aligned.

## Patterns

### Flat object (most common)

```
Respond with ONLY this JSON:
{
  "company_name": "string",
  "founded_year": 0,
  "employee_count": 0,
  "summary": "string"
}
```

### List at top level

A whole array can be one mapped variable; the consuming step receives the JSON array as the variable value.

```
{
  "questions": ["string", "string", "string"]
}
```
`outputMappings: { "questions": "interview_questions" }` → `interview_questions` holds the array.

### Multiple parallel outputs from one step

Return several flat keys; map each to its own variable.

```
{
  "tam_low": 0,
  "tam_mid": 0,
  "tam_high": 0,
  "tam_summary": "string"
}
```
`outputMappings: { "tam_low": "tam_low", "tam_mid": "tam_mid", "tam_high": "tam_high", "tam_summary": "tam_summary" }`

### Flattening instead of nesting

Need `segments` each with name + size? Don't nest if you must map them individually. Two options:

- **Pass-through (recommended when the next step is an LLM):** keep the array nested under one top-level key and let the next prompt read it.
  ```json
  { "segments": [ { "name": "...", "size_usd": "..." } ] }
  ```
  `outputMappings: { "segments": "market_segments" }` — the next step receives the full array as `{{market_segments}}`.
- **Flatten** when individual fields must drive separate steps:
  ```json
  { "segment_1_name": "...", "segment_1_size": "...", "segment_2_name": "..." }
  ```

## Few-shot to lock the shape

Instructions alone often miss edge cases (empty arrays, enums). One exemplar fixes it:

```
Example:
Input: "Acme raised a $10M Series A in 2021."
Output: {"company_name":"Acme","founded_year":null,"funding_rounds":[{"round":"Series A","amount_usd":10000000,"year":2021}]}

Now do the same for:
<user_input>
{{document}}
</user_input>

Respond with ONLY JSON in the same shape.
```

Keep exemplars minimal — they're sent on every run.

## Null & empty handling

Always state defaults so the schema is stable even on sparse input:

> "If a field is unknown, use `null`. If a list is empty, use `[]`. Never omit a key."

Stable keys mean `outputMappings` never silently drops a variable.

## Pre-ship checklist

- [ ] Every mapped field is a **top-level** key.
- [ ] JSON field names **exactly** match `outputMappings` keys (casing included).
- [ ] `expectedResponseFormat: "json"` set on the job.
- [ ] Null/empty defaults specified; no key is conditionally omitted.
- [ ] Build rules `trim-to-json` + `repair-json` enabled as a safety net.
- [ ] If shape is fragile, a few-shot exemplar is included.
