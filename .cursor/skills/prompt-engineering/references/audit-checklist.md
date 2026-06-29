# Prompt Audit Checklist

Rate each dimension: Pass / Needs work / Fail. Fix all Fail items before deploying.

> Deep-dives per dimension: grounding → [grounding.md](grounding.md); JSON schemas → [extraction-schemas.md](extraction-schemas.md); output verification → [output-verification.md](output-verification.md); model choice → [model-selection.md](model-selection.md); testing → [evaluation.md](evaluation.md).

## 1. Clarity

- [ ] Task is stated in one clear sentence
- [ ] No contradictory instructions
- [ ] Ambiguous terms are defined or exemplified

## 2. Structure

- [ ] Logical order: context → task → constraints → output format
- [ ] Sections separated (blank lines or headers) for long prompts
- [ ] Variables (`{{name}}`) are clearly distinguished from static text

## 3. Variable alignment

- [ ] Every `{{placeholder}}` has a source (inputMappings, caller variables, or workflow input)
- [ ] Placeholder names match `inputMappings` keys in workflow steps
- [ ] No orphan variables that will render empty at runtime

## 4. Output format

- [ ] Format explicitly specified (JSON schema, prose, bullet list)
- [ ] If using `outputMappings`: JSON-only instruction present
- [ ] `expectedResponseFormat: "json"` set on job config when needed
- [ ] JSON field names / paths match `outputMappings` keys exactly (top-level or dot/bracket paths)
- [ ] Null/empty defaults defined so no key is conditionally omitted

## 5. Scope

- [ ] Single responsibility per prompt/step
- [ ] Complex tasks split into workflow steps
- [ ] No "and also do X, Y, Z" unless intentional multi-output JSON

## 6. Grounding & Safety

- [ ] Extraction/analysis steps instruct "use ONLY provided data"
- [ ] Missing fields → `null`; empty lists → `[]` (no fabrication)
- [ ] Placeholder content treated as data, not instructions
- [ ] No instruction to reveal system prompt or internal instructions
- [ ] Input boundaries defined (what to do with missing/invalid input)
- [ ] No open-ended web search unless profile/agent supports it

## 7. Pipeline fit

- [ ] Step produces output the next step actually needs
- [ ] Free-form final step doesn't break downstream JSON parsing
- [ ] Auto-captured `{stepKey}.response` sufficient where outputMappings omitted

## 8. Eval readiness

- [ ] Example input + expected output documented in job test data
- [ ] Edge cases identified (empty input, partial data, off-topic)
- [ ] Formatting rules aligned with expected output type
- [ ] Diagnostics used to inspect at least one real response

## 9. Output verification

- [ ] Output contract is explicit (presence + shape + content)
- [ ] JSON jobs chain build rules: `remove-reasoning` → `trim-to-json` → `repair-json` → assertion rules (`require-keys`, `assert-json-schema`, etc.)
- [ ] Contract is **asserted** somewhere (app-side or verifier step) — including the "no JSON at all" case
- [ ] Verifier (if any) uses a cheap/fast model and flags `verified: false` instead of fabricating
- [ ] An explicit **recovery** is chosen on failure (regenerate / escalate / fallback / flag / hard-fail)
- [ ] No silent default-to-guess on missing/critical values
- [ ] Retries/failover/caching set appropriately (note: they don't catch wrong-but-successful output)

## 10. Model fit

- [ ] Capability tier matches the step (don't over-pay for classification)
- [ ] Live-data steps use an agent or Gemini-with-Search, not a plain model
- [ ] Template is model-agnostic enough to survive failover
- [ ] Temperature suits the task (low for JSON, higher for creative)

## Severity guide

| Rating | Action |
|--------|--------|
| **Fail** | Must fix before production |
| **Needs work** | Fix if time permits; document known limitation |
| **Pass** | Ship |
