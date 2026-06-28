# Integrating client apps (e.g. Lovable) with AI Admin

This document is for teams who use **AI Admin** to configure providers and profiles, and want a **separate app** (React, Lovable, internal tools) to call the same **AI Manager** HTTP API.

**Prefer a guided UI?** In AI Admin, use the sidebar link **Connect Lovable** for step-by-step instructions.

**LLM / Lovable reference:** `/integration/AI_ADMIN_LOVABLE_INTEGRATION.md` (download from the app or repo) — completion vs streaming, jobs, variables, JSON fields, and Edge Function modes. The TypeScript proxy is `/integration/ai-admin-supabase-edge-function.ts`.

## Table of contents

| Section | When you need it |
|---------|------------------|
| [1. What to set up in AI Admin first](#1-what-to-set-up-in-ai-admin-first) | Prerequisites before integrating |
| [2. Security: where the API key may live](#2-security-where-the-api-key-may-live) | Proxy pattern — never expose `aim_sk_` in browser |
| [3. Base URL and path prefix](#3-base-url-and-path-prefix) | Local vs Vercel URL construction |
| [4. Authentication headers](#4-authentication-headers) | API key, JWT, `X-Forwarded-User-Id` |
| [5. Choose an integration pattern](#5-choose-an-integration-pattern) | Completion vs job vs chat vs workflow |
| [6. CORS](#6-cors) | Why browser must use a proxy |
| [7. Rate limiting](#7-rate-limiting) | Tier limits and 429 handling |
| [8. Errors](#8-errors) | HTTP status codes and error shape |
| [9. What to tell Lovable in one prompt](#9-what-to-tell-lovable-or-any-generator-in-one-prompt) | Copy-paste spec for generators |
| [10. Common pitfalls](#10-common-pitfalls) | 409, snake_case, rule sets |
| [11–14. Session, compliance, diagnostics](#11-session-write-restrictions) | Advanced operational topics |

## 1. What to set up in AI Admin first

> **Summary:** Deploy AI Admin, join a workspace, configure providers/profiles/jobs, and create an API key stored as a secret.

1. **Deploy** the AI Admin stack (or use a shared instance your org runs).
2. **Workspace** — your user must be a member of the workspace whose data the app will use.
3. **Providers & AI profiles** — configure in the UI (or via API) so jobs and calls resolve to the right models.
4. **Processing jobs** (optional) — define slugs, prompts, and formatting rules if you use the job execution path.
5. **API key** — any workspace member creates a key in the UI (**Settings** → **API keys**). The secret is shown **once** (`aim_sk_…`). Store it in a **secret** store, not in public source control.

### Workspace trust model

AI Admin uses a **trusted workspace** model. All workspace members have equal access to workspace resources (providers, profiles, jobs, workflows, chat sessions, logs). The only privileged operation is **team management** (adding/removing members, changing roles), which requires an `admin` or `owner` role.

| Role | Difference from member |
|------|----------------------|
| `member` | Full access to all workspace resources. Cannot manage team membership. |
| `admin` | Same as member, plus can add/remove members and change roles. |
| `owner` | Same as admin. Reserved for workspace creator. |

### User credential isolation

User-specific credentials (personal API keys, OAuth tokens stored via the in-app key form) are **strictly isolated** to the owning user. No workspace member — regardless of role — can access another user's stored credentials. Credentials are encrypted at rest (AES-256-GCM) and resolved per-user during AI pipeline execution.

## 2. Security: where the API key may live

> **Summary:** Never embed `aim_sk_` in client code. Use Supabase Edge Function secrets or another server-side proxy.

- **Browser-only Lovable (or any public frontend):** do **not** embed `aim_sk_…` in client code or `VITE_*` env vars visible to the bundle. Anyone can extract it.
- **Recommended for Lovable:** deploy the **Supabase Edge Function** from the Connect Lovable guide and store `AI_ADMIN_API_KEY` plus `AI_ADMIN_BASE_URL` in **Supabase → Project Settings → Edge Function secrets**. Lovable calls `supabase.functions.invoke(...)`; the key never ships to the browser.
- **Other options:** a small server-side proxy (server action, Vercel/Netlify function, Cloudflare Worker, your own API) that holds the key and forwards `Authorization: Bearer …` to AI Admin.

If the integration is **server-to-server** only (cron, backend worker), the key can live in that server's environment.

## 3. Base URL and path prefix

> **Summary:** Local dev uses `http://localhost:3001`; Vercel deployments append `/_/backend` to the origin.

| Environment | Typical base for API calls |
|-------------|----------------------------|
| Local dev | `http://localhost:3001` (no prefix) |
| Vercel Services (this repo) | Origin + `/_/backend` — e.g. `https://your-app.vercel.app/_/backend` |

Endpoints below are expressed as paths after that base, e.g. `POST /api/chat-sessions`.

## 4. Authentication headers

> **Summary:** API keys for server proxies; JWT + `X-Workspace-Id` for admin UI; `X-Forwarded-User-Id` for per-user context.

All routes under `/api/*` except `/api/health` and `/api/auth/*` require auth.

### API key (typical for Lovable proxy / automation)

```http
Authorization: Bearer aim_sk_your_secret_here
```

The workspace is taken from the key record. You do **not** need `X-Workspace-Id` for API-key auth unless you want to assert a workspace explicitly (it must match the key's workspace).

### Forwarding end-user identity (multi-tenant)

When an `aim_sk_` API key is used from a server-side proxy on behalf of individual end-users, include:

```http
X-Forwarded-User-Id: <end-user-uuid>
```

This is trusted only with API-key auth (ignored for JWT). It enables per-user audit trails in diagnostic logs and per-user credential resolution. The value must be a valid UUID. See the Lovable handbook §2c for details.

### Supabase JWT (browser admin UI)

```http
Authorization: Bearer <supabase_access_token>
X-Workspace-Id: <uuid>
```

Used by the React admin after Google sign-in. External "product" apps usually use an **API key** via a proxy instead.

## 5. Choose an integration pattern

> **Summary:** Pick one of: one-shot completion, templated job, streaming chat, workflow, helpers, or MCP credentials.

### A. One-shot prompt (no job template) — `POST /api/ai-matcher/run-slot`

Use when you have a **prompt string** and want to run it against an **AI profile** (or ad-hoc provider slot) configured in AI Admin.

**Body (example, profile slot):**

```json
{
  "prompt": "Summarize this: …",
  "slot": { "type": "profile", "profileId": "<uuid-from-ai-profiles>" },
  "formattingRules": [],
  "slotIndex": 0,
  "attachments": []
}
```

`attachments` is optional. Each entry is `{ "url": "https://…", "mimeType": "text/csv", "fileName": "data.csv" }`. Text-based files are downloaded and prepended to the prompt.

**Response (success):** JSON with `status`, `raw`, `formatted`, `durationMs`, `model`, `provider`, `usage`, `finishReason`, etc. On failure the API may still return `200` with `status: "error"` and `error` message (see `backend/src/routes/ai-matcher.ts`).

**Discovery:** `GET /api/ai-profiles` (with auth) to list profiles and copy `id` values.

---

### B. Templated processing job — `POST /api/processing-jobs/:id/test`

Use when your team defined a **processing job** in AI Admin (slug, prompt template, `config.formattingRules`, linked `ai_profile_id`). The route name includes `test`, but it runs the same **execute** path as the admin test UI (`executeJobById`).

**Body:**

```json
{
  "variables": { "companyName": "Acme", "domain": "acme.com" },
  "promptOverride": null,
  "callingApplication": "lovable:my-app",
  "attachments": []
}
```

`callingApplication` **is required** for API-key callers — it auto-registers in AI Admin, tags diagnostic logs, and groups jobs by application. Always set it to `platform:project-name` (e.g. `lovable:my-app`). `attachments` works like pattern A above.

**Anti-spoofing:** Admins can link an API key to a calling application (`api_keys.calling_application_id`). When set, the server ignores the body field and uses the key's linked identity — making it tamper-proof. When no key link exists, the body field is required and used as-is.

**Response:** `messageSent`, `raw`, `formatted`, `formattingSteps`, `durationMs`, `model`, `usage`, `finishReason`, `diagnostics`.

**Discovery:** `GET /api/processing-jobs` for job `id` and `slug`. Open a job in the UI to confirm variable names expected in the template.

---

### C. Stateful chat (streaming) — chat sessions

1. `POST /api/chat-sessions`
   **Body:** `{ "userId": "<stable-end-user-id>", "callingApplication": "my-lovable-app", "systemPrompt": "optional" }` plus **one** session identifier: `aiProfileId`, `jobSlug`, `jobId`, `workflowSlug`, or `workflowId`. `callingApplication` is **required** for API-key callers (omitting it returns `400`). If the API key is linked to a calling application, the server uses the linked identity instead.
   When opened with a **workflow**, the response includes a `steps` array. When opened with a **chat-mode job** that has rule sets, the response includes a `ruleSets` array.

2. `POST /api/chat-sessions/:id/messages`
   **Body:** Exactly one trigger — `{ "message": "user text" }` for free-form, `{ "stepKey": "…", "variables": {…} }` for a workflow step, or `{ "ruleSetKey": "…", "variables": {…} }` for a rule set invocation. Optional `attachments` array.
   **Response:** **SSE** (`text/event-stream`), not plain JSON. Your client must use `fetch` + `ReadableStream`, `EventSource` (if applicable), or handle the stream in the proxy.
   **Variable pipeline (workflows):** When a step has `inputMappings` configured, AI Admin automatically loads accumulated variables from earlier steps and maps them into the job's expected variable names before interpolation. Caller-provided `variables` override mapped values. After the LLM responds, any `outputMappings` on the step extract top-level JSON fields from the response and store them in the session's `workflow_variables` accumulator for use by later steps. Additionally, the full prompt and response for every step are **automatically captured** as `{stepKey}.prompt` and `{stepKey}.response`, making them available to subsequent steps without explicit output mappings.

3. `POST /api/chat-sessions/:id/tool-outputs`
   **Body:** `{ "systemMessageId": "…", "outputs": [{ "toolCallId": "…", "output": "…" }] }`
   Used to resume a paused stream after an MCP tool requires user action (e.g. OAuth). Response is SSE.

4. `GET /api/chat-sessions`
   **Query params (all optional):** `userId`, `aiProfileId`, `status` (`active` | `closed`), `callingApplication`.
   API-key callers with `X-Forwarded-User-Id` are automatically scoped to that user's sessions. Returns a JSON array of session objects ordered by `updated_at` desc (limit 200). Each object includes `id`, `status`, `message_count`, token totals, timestamps, and `ai_profile: { id, name }`.
   **Edge Function mode:** `list-chat-sessions`.

5. `GET /api/chat-sessions/:id`
   Returns the full session — metadata, complete `messages` array (chronological), and a `stats` object with aggregated metrics (`messageCount`, `assistantMessageCount`, `avgResponseMs`, `avgFirstTokenMs`, `totalPromptTokens`, `totalCompletionTokens`, `totalTokens`). API-key callers with `X-Forwarded-User-Id` can only access sessions they own.
   **Edge Function mode:** `get-chat-session`.

Parse SSE `data:` lines; provider-specific chunks may appear until a completion signal. SSE connections have a **5-minute server-side timeout** — if an upstream LLM hangs, the server sends a `timeout` event and closes the connection. Handle errors and timeouts in the UI.

**Concurrency:** Only one message may be in-flight per session at a time. The server enforces this — sending a second `POST .../messages` or `POST .../tool-outputs` while a previous stream is still active returns **`409 Conflict`**. Your client must wait for the current stream to complete (`data: [DONE]`) before sending the next message. See section 8 for the error shape and section 10 for best practices.

---

### C2. Programmatic workflow creation

Calling applications can create and manage workflows entirely via the API — no admin UI required.

> **Intent-to-workflow:** If your calling application uses an LLM (e.g. Lovable, Cursor), it can decompose a user's natural language request into jobs and workflows automatically. See `docs/integration/WORKFLOW_BUILDER_PROMPT.md` for a compact, LLM-optimized reference covering the decomposition algorithm, API shapes, variable pipeline rules, and example patterns.

**1. Create processing jobs** for each step (if they don't already exist):

```
POST /api/processing-jobs
{ "name": "Analyze Data", "slug": "analyze-data", "ai_profile_id": "<uuid>",
  "config": { "promptTemplate": "Analyze {{company}}: {{rawData}}" } }
```

**2. Create the workflow with steps and variable mappings** in a single call:

```
POST /api/workflows
{
  "name": "Analysis Pipeline",
  "slug": "analysis-pipeline",
  "ai_profile_id": "<uuid>",
  "config": {
    "inputVariables": [
      { "name": "companyName", "label": "Company Name", "required": true },
      { "name": "dataSet", "label": "Data Set" }
    ]
  },
  "steps": [
    {
      "processing_job_id": "<analyze-job-uuid>",
      "step_key": "analyze",
      "name": "Analyze Data",
      "sort_order": 1,
      "config": {
        "inputMappings": { "company": "companyName", "rawData": "dataSet" },
        "outputMappings": { "strengths": "analysis_strengths", "risks": "analysis_risks" }
      }
    },
    {
      "processing_job_id": "<report-job-uuid>",
      "step_key": "report",
      "name": "Generate Report",
      "sort_order": 2,
      "depends_on": ["analyze"],
      "config": {
        "inputMappings": { "strengths": "analysis_strengths", "risks": "analysis_risks" },
        "outputMappings": { "report": "final_report" }
      }
    }
  ]
}
```

**Variable mapping explained:**

- `inputMappings`: keys are the **job template `{{placeholder}}` names**, values are **workflow variable names** loaded from earlier steps or workflow inputs. AI Admin resolves these automatically before sending the prompt.
- `outputMappings`: keys are **top-level JSON field names** in the LLM response, values are **workflow variable names** to store for later steps. AI Admin parses the response and extracts these after each step.
- Auto-captured variables: `{stepKey}.prompt` and `{stepKey}.response` are always available to later steps without configuration.

**3. Use the workflow** by opening a chat session with `workflowSlug` or `workflowId`, then trigger each step with `stepKey` and `variables`. See `API.md` → Workflows for the full reference.

**Updating steps:** `PUT /api/workflows/:id` with a `steps` array replaces all steps atomically. Use `POST /api/workflows/:id/steps` to add a single step, or `PUT /api/workflows/:wid/steps/:sid` to update one.

---

### C3. End-to-end workflow example: TAM Research

This section walks through the complete lifecycle of a multi-step workflow — from creating the jobs to reading the final results. The example builds a TAM (Total Addressable Market) research pipeline with three steps: find sources, evaluate source credibility, and calculate the TAM.

#### Step 1: Create the processing jobs

Each workflow step is backed by a processing job with a prompt template. Template placeholders use `{{variableName}}` syntax. **If a step needs structured output for the variable pipeline, the prompt must instruct the LLM to respond in JSON.**

```
POST /api/processing-jobs
{
  "name": "Find TAM Sources",
  "slug": "find-tam-sources",
  "ai_profile_id": "<your-profile-uuid>",
  "config": {
    "promptTemplate": "Research the Total Addressable Market for {{market}}.\n\nFind 5-8 credible sources (industry reports, analyst estimates, government data) that provide market size data.\n\nRespond in JSON:\n{\n  \"sources\": [\n    { \"name\": \"...\", \"url\": \"...\", \"type\": \"report|analyst|government|news\", \"relevance\": \"...\" }\n  ],\n  \"market_definition\": \"...\"\n}",
    "expectedResponseFormat": "json"
  }
}
```

```
POST /api/processing-jobs
{
  "name": "Evaluate Source Credibility",
  "slug": "evaluate-sources",
  "ai_profile_id": "<your-profile-uuid>",
  "config": {
    "promptTemplate": "Evaluate the credibility of these sources for TAM analysis of {{market}}:\n\n{{sources}}\n\nFor each source, assess: recency, methodology quality, potential bias, and reliability.\n\nRespond in JSON:\n{\n  \"evaluations\": [\n    { \"name\": \"...\", \"score\": 1-10, \"reasoning\": \"...\", \"include\": true/false }\n  ],\n  \"trusted_sources\": [\"name1\", \"name2\"]\n}",
    "expectedResponseFormat": "json"
  }
}
```

```
POST /api/processing-jobs
{
  "name": "Calculate TAM",
  "slug": "calculate-tam",
  "ai_profile_id": "<your-profile-uuid>",
  "config": {
    "promptTemplate": "Using the following trusted sources and prior analysis, calculate the TAM for {{market}}.\n\nTrusted sources: {{trusted_sources}}\nSource evaluation: {{evaluation_context}}\nOriginal research: {{research_context}}\n\nProvide:\n1. TAM estimate with range (low/mid/high)\n2. Methodology explanation\n3. Key assumptions\n4. Confidence level\n\nRespond in JSON:\n{\n  \"tam_low\": \"$X.XB\",\n  \"tam_mid\": \"$X.XB\",\n  \"tam_high\": \"$X.XB\",\n  \"methodology\": \"...\",\n  \"assumptions\": [\"...\"],\n  \"confidence\": \"low|medium|high\",\n  \"summary\": \"...\"\n}",
    "expectedResponseFormat": "json"
  }
}
```

Note: `expectedResponseFormat: "json"` tells AI Admin's formatting pipeline to apply JSON-aware parsing (e.g. `trim-to-json`) when extracting `outputMappings`.

#### Step 2: Create the workflow with variable mappings

```
POST /api/workflows
{
  "name": "TAM Research Pipeline",
  "slug": "tam-research",
  "ai_profile_id": "<your-profile-uuid>",
  "config": {
    "inputVariables": [
      { "name": "market", "label": "Target Market", "description": "The market or industry to research", "required": true }
    ]
  },
  "steps": [
    {
      "processing_job_id": "<find-tam-sources-job-uuid>",
      "step_key": "find-sources",
      "name": "Find TAM Sources",
      "sort_order": 1,
      "is_required": true,
      "config": {
        "inputMappings": {
          "market": "market"
        },
        "outputMappings": {
          "sources": "raw_sources",
          "market_definition": "market_definition"
        }
      }
    },
    {
      "processing_job_id": "<evaluate-sources-job-uuid>",
      "step_key": "evaluate",
      "name": "Evaluate Source Credibility",
      "sort_order": 2,
      "is_required": true,
      "depends_on": ["find-sources"],
      "config": {
        "inputMappings": {
          "market": "market",
          "sources": "raw_sources"
        },
        "outputMappings": {
          "trusted_sources": "trusted_sources"
        }
      }
    },
    {
      "processing_job_id": "<calculate-tam-job-uuid>",
      "step_key": "calculate",
      "name": "Calculate TAM",
      "sort_order": 3,
      "is_required": true,
      "depends_on": ["evaluate"],
      "config": {
        "inputMappings": {
          "market": "market",
          "trusted_sources": "trusted_sources",
          "evaluation_context": "evaluate.response",
          "research_context": "find-sources.response"
        },
        "outputMappings": {
          "tam_low": "tam_low",
          "tam_mid": "tam_mid",
          "tam_high": "tam_high",
          "summary": "tam_summary"
        }
      }
    }
  ]
}
```

**How `inputMappings` work:** The keys (`market`, `sources`, `trusted_sources`, etc.) are placeholder names in the job's prompt template (`{{market}}`, `{{sources}}`). The values (`market`, `raw_sources`, `evaluate.response`, etc.) are workflow variable names — either from the initial `inputVariables`, from earlier steps' `outputMappings`, or from auto-captured `{stepKey}.prompt` / `{stepKey}.response` variables.

**How `outputMappings` work:** After the LLM responds, AI Admin parses the response as JSON and extracts top-level fields. The keys (`sources`, `trusted_sources`, `tam_mid`, etc.) are field names in the JSON response. The values (`raw_sources`, `trusted_sources`, `tam_mid`, etc.) are the workflow variable names where extracted values are stored.

#### Step 3: Execute the workflow from a calling application

**The calling application drives step execution.** There is no auto-sequencing — your code triggers each step, waits for the stream to complete, then triggers the next. This gives you control to show progress, validate intermediate results, or let users modify inputs between steps.

**Open a session:**

```
POST /api/chat-sessions
{
  "workflowSlug": "tam-research",
  "userId": "<end-user-id>",
  "callingApplication": "my-app"
}
```

Response includes `sessionId` and the `steps` array with step keys, names, sort order, and dependencies. Save `sessionId`.

**Trigger step 1 (find sources):**

```
POST /api/chat-sessions/<sessionId>/messages
{
  "stepKey": "find-sources",
  "variables": { "market": "AI-powered developer tools" }
}
```

Response is **SSE** (`text/event-stream`). Consume the full stream until `data: [DONE]`. The assistant's response is the JSON with sources. After the stream completes, AI Admin automatically:
- Stores `raw_sources` and `market_definition` from `outputMappings`
- Stores `find-sources.prompt` and `find-sources.response` (auto-captured)

**Trigger step 2 (evaluate):**

```
POST /api/chat-sessions/<sessionId>/messages
{
  "stepKey": "evaluate"
}
```

No `variables` needed — `inputMappings` automatically loads `market` (from workflow input) and `raw_sources` (from step 1's output). If `find-sources` hasn't completed, the server returns **400** (`depends on incomplete steps: find-sources`).

**Trigger step 3 (calculate):**

```
POST /api/chat-sessions/<sessionId>/messages
{
  "stepKey": "calculate"
}
```

Again, no `variables` — the pipeline loads `market`, `trusted_sources`, `evaluate.response`, and `find-sources.response` from accumulated workflow variables.

#### Step 4: Read the results

After all steps complete, the session's `workflow_variables` contains every extracted and auto-captured value:

```
GET /api/chat-sessions/<sessionId>
```

The response includes `workflow_variables`:

```json
{
  "workflow_variables": {
    "market": "AI-powered developer tools",
    "raw_sources": [ ... ],
    "market_definition": "...",
    "find-sources.prompt": "...",
    "find-sources.response": "...",
    "trusted_sources": ["Gartner", "IDC", ...],
    "evaluate.prompt": "...",
    "evaluate.response": "...",
    "tam_low": "$15.2B",
    "tam_mid": "$23.7B",
    "tam_high": "$31.4B",
    "tam_summary": "...",
    "calculate.prompt": "...",
    "calculate.response": "..."
  }
}
```

Your application can read individual values (e.g. `workflow_variables.tam_mid` for a summary card) or use the full `calculate.response` for a detailed report view.

#### Edge Function integration (Lovable apps)

For Lovable apps using the Supabase Edge Function, the same flow uses the `mode` field:

```typescript
// Open session
const { data: session } = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "open-chat-session",
    workflowSlug: "tam-research",
    callingApplication: "my-lovable-app",
  },
});

// Trigger step 1
const step1Response = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "send-chat-message-stream",
    sessionId: session.id,
    stepKey: "find-sources",
    variables: { market: userInput },
  },
});
// Parse SSE stream from step1Response...

// Trigger step 2 (no variables needed — pipeline handles it)
const step2Response = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "send-chat-message-stream",
    sessionId: session.id,
    stepKey: "evaluate",
  },
});

// Trigger step 3
const step3Response = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "send-chat-message-stream",
    sessionId: session.id,
    stepKey: "calculate",
  },
});

// Read final results
const { data: fullSession } = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "get-chat-session",
    sessionId: session.id,
  },
});
const tamEstimate = fullSession.workflow_variables.tam_mid;
```

#### Key takeaways for implementers

1. **Prompt templates must produce parseable output** if you use `outputMappings`. Instruct the LLM to respond in JSON and set `expectedResponseFormat: "json"` on the job config.
2. **The calling app orchestrates step execution.** Wait for each stream to finish (`data: [DONE]`) before triggering the next step.
3. **You only provide `variables` for values the pipeline can't resolve.** On step 1, you pass the initial `market` input. On steps 2 and 3, `inputMappings` pull everything from accumulated workflow variables — no `variables` field needed.
4. **Auto-captured `{stepKey}.response` is always available.** Even without `outputMappings`, you can reference the full text of any completed step's response via `inputMappings`.
5. **Read `workflow_variables` from the session** via `GET /api/chat-sessions/:id` to access all accumulated values after the workflow completes.
6. **Dependency enforcement is server-side.** Triggering a step before its `depends_on` steps have completed returns 400.

---

### D. Helpers

- `GET /api/processing-jobs/formatting-rules` — catalogue of rule types.
- `POST /api/processing-jobs/apply-formatting` — apply rules to arbitrary text (stateless).

### E. Per-user credentials & MCP OAuth (agent profiles)

Agent profiles that use MCP tools (Gmail, Drive, Calendar, etc.) require two additional authentication layers managed through the Edge Function:

1. **Store the user's Devs.ai API key** — `POST /api/user-credentials` (Edge Function mode: `store-user-credential`)
   Body: `{ "providerId": "<Devs.ai provider UUID>", "apiKey": "<user's key>", "label": "optional" }`
   Requires `X-Forwarded-User-Id`. Key is encrypted (AES-256-GCM) and never returned.

2. **Check OAuth status per tool** — `GET /api/ai-profiles/:profileId/tools/:toolId/oauth-status` (mode: `check-tool-auth`)
   Returns `{ "hasToken": true/false }`. Call once per MCP tool.

3. **Initiate OAuth per tool** — `POST /api/ai-profiles/:profileId/tools/:toolId/oauth-initiate` (mode: `initiate-tool-oauth`)
   Returns `{ "authUrl": "https://accounts.google.com/..." }`. Redirect the user to this URL.

4. **Resume after mid-stream OAuth** — `POST /api/chat-sessions/:id/tool-outputs` (mode: `submit-tool-outputs`)
   When the AI tries to use an unauthorized tool during streaming, the SSE stream pauses with a `tool.message` event containing an `authUrl`. After the user authorizes, call this endpoint to resume. Response is SSE.

If a processing job has `requires_user_credentials: true`, `open-chat-session` returns **403** unless the user has stored their provider API key. (Prior to migration 021, this flag lived on the AI profile; it now lives on the processing job.)

See `AI_ADMIN_LOVABLE_INTEGRATION.md` §8 for complete step-by-step code with concrete UUIDs.

## 6. CORS

The AI Admin API does **not** set CORS headers. Direct browser-to-API calls from other origins will be blocked. All external integrations must go through a server-side proxy (Edge Function, BFF, API gateway) that holds the `aim_sk_` API key. This is by design — see section 2.

## 7. Rate limiting

AI Admin applies three rate-limit tiers (all per 60-second window). Limits are configurable in **Settings** → **Rate Limits**.

| Tier | Default | Applies to | Key |
|------|---------|------------|-----|
| **Global** | 200 rpm | All API endpoints | Client IP |
| **LLM** | 30 rpm | `/api/chat-sessions`, `/api/ai-matcher` | Authenticated identity (API key ID or JWT user ID); falls back to client IP for unauthenticated requests |
| **LLM (per-user)** | 15 rpm | Same endpoints, when authenticated | Authenticated identity |
| **Auth** | 15 rpm | `/api/auth/*` | Client IP |

Rate limiting uses the server-verified authenticated identity (API key ID or JWT user ID), not caller-supplied headers. When the per-user limit is set to `0` (disabled), requests fall back to the per-IP limit.

Rate-limited responses return **429** with a `Retry-After` header (seconds) and `RateLimit-*` headers (draft-7).

## 8. Errors

- **401** — missing/invalid `Authorization` or invalid API key.
- **403** — wrong workspace or role (e.g. API key cannot create keys); or RBAC restriction on user-data deletion (non-admin deleting another user's credentials or performing full purge).
- **400** — missing `X-Workspace-Id` for JWT routes that require it; invalid `X-Forwarded-User-Id` (not a UUID); missing `callingApplication` on an API-key request without a linked calling app.
- **409** — concurrent message on the same chat session. Only one message may be in-flight per session. Wait for the current SSE stream to complete (`data: [DONE]`) before sending the next message or tool output.
- **413** — JSON body too large (`API_JSON_BODY_LIMIT` on the server).
- **429** — rate limited (see section 7).

Errors are JSON: `{ "error": "..." }`. Error messages are **sanitized** — they never expose internal database details (constraint names, table names, stack traces). Always branch on HTTP status codes rather than error message substrings; message text may change between versions.

Every response includes an `X-API-Version` header reporting the server's semantic version. The `GET /api/health` endpoint also returns a `version` field.

### Documentation discovery

AI Admin publishes documentation for programmatic consumption:

- `/docs/manifest.json` — machine-readable index of all docs, version info, audience tags, and changelog entries
- `/llms.txt` — lightweight LLM-friendly overview with document links
- `/docs/CHANGELOG.md` — version history and release notes

## 9. What to tell Lovable (or any generator) in one prompt

You can paste a short spec like:

> Call our AI gateway at `BASE_URL` with header `Authorization: Bearer` + server-side env `AI_ADMIN_API_KEY`. Do not expose the key in the client.
> For a single reply: `POST /api/ai-matcher/run-slot` with JSON body `{ "prompt", "slot": { "type": "profile", "profileId": "…" } }`. Use the `raw` or `formatted` field from the JSON response.
> For our predefined pipeline: `POST /api/processing-jobs/JOB_UUID/test` with `{ "variables": { … } }` and use `formatted` from the response.
> For streaming chat: create session with `POST /api/chat-sessions`, then stream `POST /api/chat-sessions/:id/messages`.

Replace `BASE_URL`, profile UUID, and job UUID with values from your AI Admin instance.

## 10. Common pitfalls

### Concurrent messages on the same session (409 Conflict)

AI Admin enforces **one message at a time per chat session**. If your client sends a second `POST .../messages` or `POST .../tool-outputs` while a previous stream is still in progress, the server responds with **`409 Conflict`**.

**How to avoid 409s:**
- **Wait for `data: [DONE]`** before allowing the next send. Your SSE parser should track whether the stream has completed.
- **Disable the send UI** while a stream is active. Re-enable it only after `[DONE]` or an error/timeout.
- **Implement a send queue** if your app generates messages programmatically (e.g. sequential rule set invocations). Process one at a time, advancing only after the previous stream completes.

**How to handle 409 if it occurs:**
- Show a brief "please wait" message to the user. Do not silently retry in a tight loop.
- If retrying programmatically, wait at least 1-2 seconds and use exponential backoff.

The lock auto-expires after approximately 5.5 minutes (the 5-minute SSE timeout plus a buffer), so sessions cannot be permanently locked by a crashed client.

### Snake_case column names on PUT

`PUT /api/processing-jobs/:id` passes the JSON body directly to the database with **no camelCase-to-snake_case conversion**. Use database column names: `ai_profile_id` (not `aiProfileId`), `is_active` (not `isActive`), `calling_application` (not `callingApplication`). The `config` JSONB field is the exception — keys inside `config` (like `promptTemplate`, `formattingRules`, `ruleSets`) are application-defined and use camelCase.

### Rule set updates replace the entire array

`PUT` deep-merges `config`, but arrays (including `config.ruleSets`) are **replaced wholesale** — not merged element-by-element. Always read the job first, modify the rule set in place, then write the full `ruleSets` array back. See the Lovable handbook §11 for the read-modify-write pattern.

### Rule sets are identified by key, not UUID

Rule sets are JSON objects inside `config.ruleSets`, not standalone database entities. They have no UUID and no dedicated API routes. The `key` string (e.g. `"analyze-company"`) is the only identifier. Invoke with `ruleSetKey`, update via the parent job's `PUT`.

## 11. Session write restrictions

JWT (admin UI) callers can only **write** to sessions they own. This means `POST .../messages`, `POST .../tool-outputs`, `PUT .../reset`, and `PUT .../close` return **403** if `session.user_id` does not match the JWT user.

**Read and delete remain workspace-wide** — any authenticated member can view any session (for troubleshooting) and delete any session (for remediating accidental exposure of sensitive content).

API-key callers retain workspace-wide write access (trusted server credentials). API keys with `X-Forwarded-User-Id` are still scoped to the forwarded user's sessions.

## 12. Compliance data deletion (GDPR / CCPA)

AI Admin provides purpose-built endpoints for erasing user data in compliance with data protection regulations.

**Base path:** `DELETE /api/user-data/:userId`

| Endpoint | Deletes |
|----------|---------|
| `DELETE /api/user-data/:userId` | All data: sessions, diagnostic logs, credentials |
| `DELETE /api/user-data/:userId/sessions` | Chat sessions + messages only |
| `DELETE /api/user-data/:userId/diagnostic-logs` | Diagnostic logs only |
| `DELETE /api/user-data/:userId/credentials` | Provider credentials only |

All endpoints require `{ "confirm": "DELETE_USER_DATA" }` in the request body. The response includes counts of deleted records.

**UI location:** Settings → Data Management tab (deliberately the last tab to prevent accidental clicks).

**Edge Function mode:** To invoke from a calling application, send a `DELETE` request with the confirmation body through the Edge Function proxy. Ensure the API key has workspace access.

## 13. Diagnostics

Diagnostic logging is **enabled by default** for all processing jobs. Every job execution and workflow step produces a diagnostic log entry containing request payloads, LLM timing, token usage, and error details.

- **Default behavior:** Jobs without an explicit `advanced.diagnostics` configuration automatically have diagnostics enabled with `mode: 'always'` (persisted to the database). To opt out, set `advanced.diagnostics.enabled: false` in the job config.
- **Query diagnostic logs:** `GET /api/diagnostic-logs?processingJobId=<id>` or `GET /api/diagnostic-logs?chatSessionId=<id>` for workflow session logs.
- **Per-step identification:** Each diagnostic log entry includes the `stepKey` in its `request_payload`, allowing you to correlate logs with specific workflow steps.

## 14. Maintaining this doc

When you add or rename HTTP routes, update this file and the README pointer. For the exact contract, the source of truth is `backend/src/routes/*.ts` and `backend/src/middleware/auth.ts`.
