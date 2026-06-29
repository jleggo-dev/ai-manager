# AI Admin — Workflow Builder Reference

> **Audience:** You are a code-generating LLM (Lovable, Cursor, Copilot, etc.). A user has described an AI-powered feature they want. This document tells you how to create the necessary AI Admin infrastructure — profiles, jobs, and workflows — via API calls.

## Table of contents

| Section | When you need it |
|---------|------------------|
| [Two-phase flow](#two-phase-flow) | Plan before building |
| [1. Decomposition algorithm](#1-decomposition-algorithm) | Break user intent into steps |
| [2. API reference (compact)](#2-api-reference-compact) | Create profiles, jobs, workflows |
| [3. Variable pipeline rules](#3-variable-pipeline-rules) | inputMappings, outputMappings |
| [4. Profile selection guide](#4-profile-selection-guide) | Pick or create AI profiles |
| [5. Naming conventions](#5-naming-conventions) | Slugs and step keys |
| [6. Confirmation UX](#6-confirmation-ux) | Present plan to user first |
| [7. Prompt template design](#7-prompt-template-design) | JSON output for pipelines |
| [8. Example decompositions](#8-example-decompositions) | TAM, interview prep, content |
| [9. Execution wiring](#9-execution-wiring) | Connect workflow to app |

## Two-phase flow

> **Summary:** Phase 1 presents a plan; Phase 2 creates infrastructure via API after user confirms.

**Phase 1 — Plan:** Decompose the user's intent into logical steps. Present the plan in plain language. Wait for confirmation before creating anything.

**Phase 2 — Build:** Generate code that calls the AI Admin API to create profiles (if needed), processing jobs, and the workflow. Then wire the execution into the calling app.

---

## 1. Decomposition algorithm

> **Summary:** Identify goal → break into 2–5 steps → order dependencies → design data flow → choose JSON vs free-form output.

Given a user's intent (e.g. "build a TAM for a new market"):

1. **Identify the goal** — what is the final output the user wants?
2. **Break into 2-5 discrete reasoning steps** — each step should do one thing well. A step is a distinct LLM call with its own prompt.
3. **Order the steps** — which steps depend on which? Build a dependency chain.
4. **Design the data flow** — what does each step produce that the next step needs? These become variable mappings.
5. **Choose the prompt strategy** — for each step, decide: does it need structured (JSON) output for the pipeline, or is free-form text sufficient?

### Common decomposition patterns

| Pattern | Steps | Example |
|---------|-------|---------|
| Research pipeline | gather → evaluate → synthesize | TAM analysis, competitive research |
| Content creation | outline → draft → review | Blog posts, reports, proposals |
| Analysis | collect data → process → summarize | Financial analysis, code review |
| Evaluation | assess → score → recommend | Candidate screening, vendor selection |
| Multi-perspective | analyze → generate variants → compare | A/B copy, multi-audience messaging |

### When NOT to use a workflow

Use a **single processing job** (no workflow) when:
- The task is a single LLM call (summarize, translate, classify)
- There's no data dependency between steps
- The user just needs a one-shot completion

---

## 2. API reference (compact)

Base URL: The AI Admin instance URL (e.g. `https://your-ai-admin.example.com`).
Auth header: `Authorization: Bearer aim_sk_...` (API key).

### Discover existing resources

```
GET /api/providers          → { data: [{ id, name, type, is_active }] }
GET /api/ai-profiles        → { data: [{ id, name, provider_id, external_ai_id, mode, is_active, provider: { id, name, type } }] }
GET /api/providers/:id/models → [{ id, model_id, display_name, category, is_active }]
```

### Create an AI profile

Only needed if no suitable profile exists. Check existing profiles first.

```
POST /api/ai-profiles
{
  "name": "string (required)",
  "provider_id": "uuid (required) — from GET /api/providers",
  "external_ai_id": "string (required) — the model identifier (e.g. 'gpt-4o', 'gemini-2.0-flash')",
  "mode": "chat",
  "description": "string (optional)",
  "runtime_options": {
    "temperature": 0.5,
    "max_tokens": 4096
  }
}
```

### Create a processing job

One per workflow step. The `config.promptTemplate` uses `{{variableName}}` placeholders.

```
POST /api/processing-jobs
{
  "name": "string (required) — human-readable",
  "slug": "string (required) — kebab-case, e.g. 'find-sources'",
  "ai_profile_id": "uuid (optional) — links to a profile; workflow can also set a default",
  "config": {
    "promptTemplate": "string — the prompt with {{placeholders}}",
    "expectedResponseFormat": "json | null — set to 'json' when using outputMappings"
  }
}
```

### Create a workflow with inline steps

```
POST /api/workflows
{
  "name": "string (required)",
  "slug": "string (required) — kebab-case",
  "ai_profile_id": "uuid (optional) — default profile for all steps",
  "config": {
    "inputVariables": [
      { "name": "varName", "label": "Display Label", "description": "...", "required": true }
    ]
  },
  "steps": [
    {
      "processing_job_id": "uuid (required) — from the job you just created",
      "step_key": "string (required) — kebab-case identifier, e.g. 'find-sources'",
      "name": "string (required) — human-readable step name",
      "sort_order": 1,
      "is_required": true,
      "depends_on": ["step-key-of-predecessor"],
      "config": {
        "inputMappings": {
          "templatePlaceholder": "workflowVariableName"
        },
        "outputMappings": {
          "jsonResponseField": "workflowVariableName"
        }
      }
    }
  ]
}
```

---

## 3. Variable pipeline rules

The variable pipeline is how data flows between workflow steps automatically.

### inputMappings

Maps **prompt template placeholders** to **workflow variable names**.

```json
{ "market": "market", "sources": "raw_sources" }
```

This means: replace `{{market}}` with the workflow variable `market`, and `{{sources}}` with the workflow variable `raw_sources`.

Variable sources (resolved in order):
1. `config.inputVariables` — initial values provided when triggering the step
2. Earlier steps' `outputMappings` — extracted JSON fields stored as workflow variables
3. Auto-captured `{stepKey}.prompt` and `{stepKey}.response` — always available for every completed step

### outputMappings

After the LLM responds, AI Admin parses the response as JSON and extracts fields by key or path.

```json
{ "sources": "raw_sources", "analysis.score": "lead_score", "items[0].title": "first_item" }
```

Keys may be **top-level field names** (`sources`) or **dot/bracket paths** into nested JSON (`analysis.score`, `items[0].title`). The resolved value is stored under the workflow variable name (right-hand side).

**Important:** `outputMappings` require `expectedResponseFormat: "json"` on the job config, and the prompt must instruct the LLM to respond in JSON.

### Auto-captured variables

After every workflow step completes, AI Admin automatically stores:
- `{stepKey}.prompt` — the fully resolved prompt that was sent
- `{stepKey}.response` — the complete LLM response text

These are available to subsequent steps via `inputMappings` without explicit `outputMappings`. Use them when you want to pass the full context of an earlier step rather than specific extracted fields.

---

## 4. Profile selection guide

### Check existing profiles first

```
GET /api/ai-profiles
```

If a profile with a suitable model and mode (`chat`) already exists, reuse it. Note its `id`.

### Creating a new profile — model selection heuristics

| Task type | Model guidance | Temperature | Notes |
|-----------|---------------|-------------|-------|
| Complex reasoning, research, analysis | Largest available model (GPT-4o, Claude 3.5, Gemini 1.5 Pro) | 0.3–0.5 | Needs strong instruction-following |
| Data extraction, JSON output | Mid-tier model is fine | 0.1–0.3 | Lower temperature = more consistent JSON |
| Creative writing, brainstorming | Large model preferred | 0.7–0.9 | Higher temperature = more variety |
| Simple classification, formatting | Smallest model that works | 0.1–0.3 | Save cost on simple tasks |

### When all steps can share a profile

If every step uses the same model and similar settings, create one profile and set it as the workflow's `ai_profile_id`. Individual steps inherit it.

### When steps need different profiles

If one step needs a cheap/fast model and another needs a powerful one, create separate profiles and assign them at the job level (`ai_profile_id` on each processing job).

---

## 5. Naming conventions

| Resource | Pattern | Example |
|----------|---------|---------|
| Workflow name | Title Case, describes the pipeline | "TAM Research Pipeline" |
| Workflow slug | kebab-case | `tam-research` |
| Step key | kebab-case verb-noun | `find-sources`, `evaluate-credibility` |
| Job name | Title Case, matches step purpose | "Find TAM Sources" |
| Job slug | kebab-case, matches or aligns with step key | `find-tam-sources` |
| Variable names | snake_case or kebab-case, descriptive | `raw_sources`, `trusted_sources` |

Group related jobs by using a common prefix in their slugs (e.g. `tam-find-sources`, `tam-evaluate`, `tam-calculate`).

---

## 6. Confirmation UX

Before executing API calls, present the plan to the user. Template:

```
I'll set up a [N]-step AI workflow for [goal]:

1. **[Step Name]** — [what this step does]
2. **[Step Name]** — [what this step does, what it receives from step 1]
3. **[Step Name]** — [what this step does, what it produces as the final output]

Data flow: [Step 1] produces [X], which feeds into [Step 2]. [Step 2] produces [Y],
which [Step 3] uses to generate the final [output description].

AI model: [model name] (via existing profile "[profile name]")

Should I go ahead and create this?
```

Adjust the detail level to the user's technical sophistication. Non-technical users care about what each step does and what the final output looks like. Technical users also want to know about variable mappings and model choices.

---

## 7. Prompt template design

> **Summary:** Use `{{variable}}` placeholders; instruct JSON output when using `outputMappings`; set `expectedResponseFormat: "json"`.

Each job's `config.promptTemplate` is the actual prompt sent to the LLM, with `{{placeholders}}` replaced by variable values at runtime.

### Getting reliable JSON responses

When a step uses `outputMappings`, the LLM's response must be parseable JSON with field names that match the `outputMappings` keys. See `AI_ADMIN_LOVABLE_INTEGRATION.md` section "Writing prompts that return structured JSON" for the full pattern. The short version:

- End the prompt with "Respond with ONLY the following JSON — no markdown, no explanation, no extra text:" followed by the exact schema
- Field names in the schema must match your `outputMappings` keys
- Set `expectedResponseFormat: "json"` on the job config
- If a step doesn't need parsed output (final step, or referenced only via `{stepKey}.response`), skip JSON and use a natural prompt

### Other template rules

- **Keep placeholders descriptive.** `{{market_research_data}}` is better than `{{data}}`.
- **Reference earlier context naturally.** When a step receives `{stepKey}.response` from an earlier step:
  ```
  Based on the following research:
  {{research_context}}

  Now evaluate...
  ```
- **One responsibility per step.** Don't ask a single step to research AND evaluate AND synthesize. Split into focused steps.

---

## 8. Example decompositions

### Example A: TAM Research (3 steps)

**User intent:** "Build a workflow that researches a Total Addressable Market"

**Decomposition:**
- Step 1 `find-sources`: Find credible market data sources → outputs `raw_sources`, `market_definition`
- Step 2 `evaluate`: Evaluate source credibility → outputs `trusted_sources`
- Step 3 `calculate`: Calculate TAM using trusted sources → outputs `tam_low`, `tam_mid`, `tam_high`, `tam_summary`

**Variable flow:** User provides `market` → step 1 uses it, produces `raw_sources` → step 2 consumes `raw_sources`, produces `trusted_sources` → step 3 consumes `trusted_sources` + `evaluate.response` + `find-sources.response`, produces final estimates.

**All steps use `expectedResponseFormat: "json"` and structured output prompts.**

See `INTEGRATION.md` section C3 for the complete API payloads.

### Example B: Interview Prep (3 steps)

**User intent:** "Help users prepare for job interviews"

**Decomposition:**
- Step 1 `analyze-posting`: Analyze the job posting for key requirements → outputs `key_requirements`, `company_focus`, `role_level`
- Step 2 `generate-questions`: Generate tailored interview questions based on requirements → outputs `questions`
- Step 3 `create-study-plan`: Create a personalized study plan → outputs `study_plan`, `timeline`

**Variable flow:** User provides `job_posting` and `resume_summary` → step 1 extracts structure → step 2 uses requirements to generate questions → step 3 builds a plan from everything.

**Profile choice:** All steps can share one high-capability chat profile (GPT-4o or equivalent, temperature 0.4).

### Example C: Content Pipeline (2 steps, simpler)

**User intent:** "Generate blog posts from topic ideas"

**Decomposition:**
- Step 1 `outline`: Create a structured outline with sections and key points → outputs `outline`, `title`, `target_audience`
- Step 2 `draft`: Write the full blog post following the outline → free-form text output (no outputMappings needed)

**Variable flow:** User provides `topic` and `tone` → step 1 produces structured outline → step 2 uses `outline.response` (auto-captured) to write the draft.

**Profile choice:** Step 1 uses a mid-tier model (structured output). Step 2 uses a high-capability model with higher temperature (0.7) for creative writing — separate profiles.

---

## 9. Execution wiring

After creating the resources, the calling app needs code to execute the workflow. The pattern is always:

1. **Open a session** — `POST /api/chat-sessions` with `workflowSlug` (or `workflowId`)
2. **Trigger each step in order** — `POST /api/chat-sessions/:id/messages` with `stepKey` and `variables` (only for step 1; subsequent steps auto-resolve)
3. **Consume the SSE stream** — each step returns `text/event-stream`; wait for `data: [DONE]`
4. **Read results** — `GET /api/chat-sessions/:id` returns `workflow_variables` with all accumulated values

For Edge Function apps (Supabase/Lovable), use the `mode` field:
- `"open-chat-session"` with `workflowSlug`
- `"send-chat-message-stream"` with `sessionId` + `stepKey` + optional `variables`
- `"get-chat-session"` with `sessionId` to read final `workflow_variables`
- `"resume-chat-session"` with `sessionId` (or `externalChatId`) to continue a paused workflow — the response restores `completedSteps` and `workflowVariables`, so you can pick up at the next pending step

**Resuming a partially-completed workflow:** If a user steps away mid-pipeline, the session can be closed and later resumed with `POST /api/chat-sessions/resume`. Resume returns `completedSteps` (which `stepKey`s already ran) and the accumulated `workflowVariables`, so the calling app knows which step to trigger next without re-running earlier ones.

See `INTEGRATION.md` section C3 and `AI_ADMIN_LOVABLE_INTEGRATION.md` section 10 for complete code examples.
