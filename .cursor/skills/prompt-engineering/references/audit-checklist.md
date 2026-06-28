# Prompt Audit Checklist

Rate each dimension: Pass / Needs work / Fail. Fix all Fail items before deploying.

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
- [ ] JSON field names match `outputMappings` keys exactly

## 5. Scope

- [ ] Single responsibility per prompt/step
- [ ] Complex tasks split into workflow steps
- [ ] No "and also do X, Y, Z" unless intentional multi-output JSON

## 6. Safety

- [ ] No instruction to reveal system prompt or internal instructions
- [ ] Input boundaries defined (what to do with missing/invalid input)
- [ ] No open-ended web search unless profile supports it

## 7. Pipeline fit

- [ ] Step produces output the next step actually needs
- [ ] Free-form final step doesn't break downstream JSON parsing
- [ ] Auto-captured `{stepKey}.response` sufficient where outputMappings omitted

## 8. Eval readiness

- [ ] Example input + expected output documented in job test data
- [ ] Edge cases identified (empty input, partial data, off-topic)
- [ ] Formatting rules aligned with expected output type

## Severity guide

| Rating | Action |
|--------|--------|
| **Fail** | Must fix before production |
| **Needs work** | Fix if time permits; document known limitation |
| **Pass** | Ship |
