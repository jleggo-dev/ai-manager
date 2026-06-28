---
name: prompt-engineering
description: Authors and audits LLM prompts for AI Admin processing jobs and workflows. Use when writing prompt templates, designing JSON output schemas, creating processing jobs, improving prompt quality, or when the user asks about prompt engineering, COSTAR, chain-of-thought, or structured LLM output.
---

# Prompt Engineering for AI Admin

Guide for crafting effective prompts in AI Admin processing jobs, with conventions specific to the variable pipeline.

## When to use this skill

- Writing or reviewing `config.promptTemplate` for a processing job
- Designing prompts that feed `outputMappings` in workflows
- Auditing existing prompts for reliability, clarity, or JSON parseability
- Choosing between free-form and structured (JSON) output

## AI Admin prompt conventions

### Template placeholders

Use `{{variableName}}` syntax matching job template placeholders and workflow `inputMappings` keys:

```
Research the Total Addressable Market for {{market}}.

Find 5-8 credible sources...
```

Rules:
- Keep names descriptive: `{{market_research_data}}` not `{{data}}`
- One responsibility per step — don't combine research + evaluate + synthesize
- Reference earlier steps naturally when using `{stepKey}.response` variables

### JSON output for variable pipeline

When a workflow step uses `outputMappings`, the LLM response **must** be parseable JSON with top-level fields matching the mapping keys.

Required setup:
1. End prompt with explicit schema instruction
2. Set `expectedResponseFormat: "json"` on job config
3. Field names in schema must match `outputMappings` keys exactly

Template pattern:

```
Analyze {{company}} using the data below:
{{rawData}}

Respond with ONLY the following JSON — no markdown, no explanation:
{
  "strengths": ["..."],
  "risks": ["..."],
  "score": 0
}
```

If a step doesn't need parsed output (final report step, or only referenced via `{stepKey}.response`), use natural language — skip JSON.

## Prompt structure framework

Use COSTAR for complex prompts (see [references/frameworks.md](references/frameworks.md)):

| Element | Purpose |
|---------|---------|
| **Context** | Background the model needs |
| **Objective** | What to produce |
| **Style** | Tone and format |
| **Tone** | Voice (professional, concise, etc.) |
| **Audience** | Who reads the output |
| **Response** | Exact output format (especially JSON schema) |

Minimal template for a processing job:

```
[Context] You are analyzing {{market}} for a B2B SaaS company.

[Objective] Identify the top 5 market segments with size estimates.

[Response] Respond with ONLY this JSON:
{ "segments": [{ "name": "...", "size_usd": "...", "rationale": "..." }] }
```

## Audit checklist

Before finalizing a prompt, verify (full checklist: [references/audit-checklist.md](references/audit-checklist.md)):

- [ ] **Clarity** — unambiguous task; no conflicting instructions
- [ ] **Variables** — all `{{placeholders}}` have corresponding inputMappings or caller variables
- [ ] **JSON reliability** — if using outputMappings: explicit schema, "ONLY JSON" instruction, `expectedResponseFormat: "json"`
- [ ] **Scope** — single responsibility; split if doing multiple reasoning steps
- [ ] **Edge cases** — what if input is empty, malformed, or off-topic?
- [ ] **No leakage** — don't instruct the model to reveal system prompts to end users
- [ ] **Formatting rules** — if post-processing needed, confirm matching rules exist in job config

## Chain-of-thought (when to use)

Use explicit reasoning steps in the prompt when:
- Task requires multi-step analysis before a conclusion
- Output quality improves with visible reasoning (then extract final answer)

Skip CoT when:
- Step uses `outputMappings` and needs clean JSON (reasoning breaks parsing)
- Task is simple classification or extraction

For CoT with JSON output, ask for reasoning in a separate field:

```json
{
  "reasoning": "...",
  "conclusion": "...",
  "confidence": "high"
}
```

## Workflow prompt design

When designing prompts for a multi-step workflow:

1. **Step 1** — gather/extract raw data (JSON output for pipeline)
2. **Middle steps** — transform/evaluate using prior step variables
3. **Final step** — synthesize for human consumption (free-form OK)

Map data flow explicitly:
- `inputMappings`: `{ "sources": "raw_sources" }` — job placeholder → workflow var
- `outputMappings`: `{ "sources": "raw_sources" }` — JSON field → workflow var

## Anti-patterns

| Don't | Do instead |
|-------|-----------|
| Ask for markdown-wrapped JSON | "Respond with ONLY JSON, no markdown fences" |
| Vague placeholders `{{input}}` | Descriptive names matching workflow variables |
| One prompt doing 3+ distinct tasks | Split into workflow steps |
| Hardcode values that should be variables | Use `{{variable}}` for dynamic content |
| Skip `expectedResponseFormat` when using outputMappings | Always set `"json"` |

## Additional resources

- [references/frameworks.md](references/frameworks.md) — COSTAR, RTF, CRISPE templates
- [references/audit-checklist.md](references/audit-checklist.md) — full 8-dimension audit
- [docs/integration/WORKFLOW_BUILDER_PROMPT.md](../../docs/integration/WORKFLOW_BUILDER_PROMPT.md) — prompt design for workflows
- [docs/integration/AI_ADMIN_LOVABLE_INTEGRATION.md § Writing JSON prompts](../../docs/integration/AI_ADMIN_LOVABLE_INTEGRATION.md) — structured output patterns
