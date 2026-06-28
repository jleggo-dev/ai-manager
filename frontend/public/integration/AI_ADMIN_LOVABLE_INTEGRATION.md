# AI Admin + Lovable + Supabase — Integration handbook

Upload this file into your Lovable project (or any repo) so the **LLM** has a single source of truth for APIs, JSON shapes, jobs, variables, **completion vs streaming**, and how to bootstrap Edge Functions.

> **Programmatic discovery:** AI Admin publishes a machine-readable manifest at `/docs/manifest.json` and an LLM-friendly index at `/llms.txt`. Tools can fetch these to discover available documentation, the current API version, and changelog entries without manual upload. The `X-API-Version` response header on every API response also reports the running server version.

## Table of contents

| Section | When you need it |
|---------|------------------|
| [Enforcement rules](#enforcement-rules) | MUST/NEVER security rules — read first |
| [Pre-implementation checklist](#pre-implementation-checklist) | Verify before writing code |
| [1. Roles of each system](#1-roles-of-each-system) | AI Admin vs Supabase vs Lovable |
| [2. Secrets (Supabase)](#2-secrets-supabase) | `AI_ADMIN_API_KEY`, base URL normalization |
| [2b. callingApplication](#2b-identify-your-project-callingapplication) | Required app identifier |
| [2c. X-Forwarded-User-Id](#2c-per-user-identity-x-forwarded-user-id) | Per-user credentials and sessions |
| [3. Completion vs streaming](#3-completion-one-shot-vs-streaming-chat) | When to use each pattern |
| [4. Edge Function modes](#4-edge-function-modes-reference-implementation) | All proxy modes with examples |
| [5. Interpreting JSON](#5-interpreting-json--completion-responses) | Parse completion responses |
| [6. SSE Event Reference](#6-sse-event-reference-and-best-practices) | Streaming parser and events |
| [7. Bootstrap checklist](#7-bootstrap-checklist-for-lovable) | Step-by-step Lovable setup |
| [7b. Intent-to-Workflow](#7b-intent-to-workflow-letting-users-describe-what-they-want) | Decompose user requests |
| [8. MCP Tools](#8-mcp-tools--external-integrations-gmail-google-drive-slack-etc) | OAuth and per-user keys |
| [9. File Attachments](#9-file-attachments--ai-generated-files) | Upload and receive files |
| [10. Workflows](#10-workflows--structured-steps-in-a-chat-session) | Multi-step variable pipeline |
| [11. Rule Sets](#11-rule-sets--multiple-invocable-prompts-in-a-chat-job) | Named prompts in chat jobs |
| [12–19. Production patterns](#12-what-lovable-developers-need-to-build) | Build guide, anti-patterns, errors |

---

## Enforcement rules

> **Summary:** Non-negotiable MUST/NEVER rules for API key security, JWT validation, SSE via fetch, and session concurrency.

These are **non-negotiable**. The LLM generating code MUST follow every rule marked with `MUST` or `NEVER`. Rules marked `SHOULD` are strong recommendations that may be relaxed with explicit user approval.

> **MUST:** Every Edge Function mode that receives a user request MUST validate the caller's Supabase JWT via `supabase.auth.getUser()` before processing. Never skip auth — even for "app-context" completion modes, the JWT proves the request came from your app, not an attacker.

> **MUST:** The `aim_sk_` API key MUST only exist in Supabase Edge Function secrets (`AI_ADMIN_API_KEY`). It MUST never appear in frontend code, `.env` files committed to the repo, or browser-accessible locations.

> **MUST:** Every upstream call to AI Admin that operates in user-context MUST include the `X-Forwarded-User-Id` header. Omitting it silently degrades to app-context and breaks per-user credentials, MCP OAuth, and session access control.

> **MUST:** SSE streaming MUST use the browser `fetch()` API, not `supabase.functions.invoke()`. The `invoke()` method does not support streaming — it buffers the entire response before returning.

> **MUST:** Supabase secrets (`AI_ADMIN_API_KEY`, `AI_ADMIN_BASE_URL`) MUST be set in **Supabase Dashboard → Edge Functions → Secrets**. They MUST NOT be stored in Lovable's `.env`, frontend code, or any client-accessible location.

> **MUST:** Every `run-processing-job` and `open-chat-session` call MUST include a `callingApplication` string in the format `platform:project-name` (e.g. `lovable:marketplace-prod`). This is **server-enforced** — omitting it returns `400 Bad Request`. The field tags diagnostic logs, auto-registers the app in AI Admin, and groups jobs by application. If the admin has linked the API key to a calling application, the server uses that identity instead (the body field is ignored) — this prevents spoofing.

> **MUST:** Only one message may be in-flight per chat session at a time. The client MUST wait for the current SSE stream to complete (`data: [DONE]`) before sending the next `send-chat-message-stream` or `submit-tool-outputs` call. AI Admin enforces this server-side — concurrent sends return **`409 Conflict`**. The send button (or equivalent trigger) MUST be disabled while a stream is active, and the app MUST handle 409 responses gracefully (show a "please wait" message, do not retry in a tight loop).

> **SHOULD:** Responses to the user SHOULD show `formatted` (preferred) or `raw` text from completion responses. The `messageSent` field SHOULD NOT be displayed to end-users (it contains the full prompt including system instructions).

> **SHOULD:** Tool call visibility SHOULD default to "collapsed" (brief activity indicators). Users SHOULD be given a setting to change this.

---

## Pre-implementation checklist

> **Summary:** Verify secrets, JWT validation, user identity forwarding, and streaming via fetch before writing code.

Before writing or modifying Edge Function or frontend code, verify every item:

1. **Secrets present?** — `AI_ADMIN_API_KEY` and `AI_ADMIN_BASE_URL` are set in Supabase Dashboard → Edge Functions → Secrets. Not in `.env`, not in code.
2. **JWT validation?** — Every Edge Function mode calls `supabase.auth.getUser(jwt)` before processing. Unauthenticated requests return `401` before reaching AI Admin.
3. **User identity forwarded?** — Every `aiAdminHeaders()` call that needs user-context includes `X-Forwarded-User-Id: <user.id>`. Grep for all `aiAdminHeaders(` calls and confirm every one that needs user-context passes the userId.
4. **No hardcoded keys?** — No API keys, secrets, or base URLs appear in frontend React code. All of these live in Supabase secrets and are only accessed inside Edge Functions.
5. **Streaming uses fetch?** — All `send-chat-message-stream` and `submit-tool-outputs` calls use `fetch()` with `ReadableStream`, not `supabase.functions.invoke()`.
6. **callingApplication set?** — Every `run-processing-job` and `open-chat-session` call **MUST** include `callingApplication` with a stable project identifier (e.g. `lovable:my-project-name`). Server-enforced — omitting it returns `400`.

---

## 1. Roles of each system

| System | Role |
|--------|------|
| **AI Admin** | Hosts **Providers**, **AI Profiles** (which model to use), and **Processing Jobs** (prompt templates + formatting). Exposes a full **REST API** — your app can create, update, list, and delete jobs programmatically via Edge Functions (no UI required). Issues **API keys** (`aim_sk_…`). |
| **Supabase** | Holds **secrets** (`AI_ADMIN_API_KEY`, `AI_ADMIN_BASE_URL`) and runs **Edge Functions** that call AI Admin. The browser never sees the API key. |
| **Lovable** | Your UI. Calls `supabase.functions.invoke()` for JSON, or `fetch()` for **SSE streams** when noted below. |

Think of **Profiles** as "which brain," **Jobs** as "a saved recipe with blanks to fill in (**variables**)," and **chat sessions** as "an ongoing conversation that can **stream** tokens."

### Where to verify the integration

- **Strongest check — Lovable (or your app):** After the Edge Function is deployed and Supabase secrets are set, use a **small test page in Lovable** that calls `supabase.functions.invoke` (see **Connect Lovable → Step 7** and **Prompt B** in AI Admin). That exercises the same chain you ship: UI → Edge Function → AI Admin → model. Teams often find this **more effective** than repeating tests only inside AI Admin.
- **AI Admin → Jobs → Test tab:** Still valuable for **iterating** on the prompt, **variables**, default **test data**, and **expected response schema** while logged in with a browser session. It calls AI Admin **directly** (not through your Edge Function), so a green test there **does not** by itself prove Supabase secrets or Edge Function code.

---

## 2. Secrets (Supabase)

Set in **Project Settings → Edge Functions → Secrets** (wording may vary):

| Secret | Value |
|--------|--------|
| `AI_ADMIN_API_KEY` | Full key from AI Admin → **Settings → API keys** (starts with `aim_sk_`). Shown once. |
| `AI_ADMIN_BASE_URL` | The Vercel domain of the AI Admin app, e.g. `https://ai-manager-alpha-seven.vercel.app`. Users may paste either the bare domain or the full backend URL — your edge function must handle both (see below). |

> **IMPORTANT — Normalize the base URL in your edge function code.** On Vercel, the backend API lives behind a `/_/backend` route prefix. Users may set `AI_ADMIN_BASE_URL` to the bare domain (e.g. `https://ai-manager-alpha-seven.vercel.app`) or the full backend path (`https://ai-manager-alpha-seven.vercel.app/_/backend`). Your edge function **must** normalize this so it always works regardless of what the user entered. Use this helper at the top of every edge function that calls AI Admin:

```typescript
const rawBase = Deno.env.get("AI_ADMIN_BASE_URL") ?? "";
// Normalize: ensure the URL ends with /_/backend for Vercel deployments.
// Works whether the user set the bare domain or the full backend path.
const AI_ADMIN_BASE_URL = rawBase.includes("/_/backend")
  ? rawBase.replace(/\/+$/, "")
  : rawBase.includes("localhost")
    ? rawBase.replace(/\/+$/, "")
    : rawBase.replace(/\/+$/, "") + "/_/backend";
```

All AI Admin routes below are **relative to this normalized base** (e.g. `${AI_ADMIN_BASE_URL}/api/ai-matcher/run-slot`).

Edge Functions must send:

```http
Authorization: Bearer <AI_ADMIN_API_KEY>
Content-Type: application/json
```

(API keys do **not** require `X-Workspace-Id`; the workspace is implied by the key.)

---

## 2b. Identify your project (`callingApplication`)

Every API call that runs a job or opens a chat session **MUST** include a `callingApplication` string. **Use the format `platform:project-name`** — for example `lovable:marketplace-prod` or `lovable:internal-tools`. This is **server-enforced** — omitting it returns **`400 Bad Request`**. This string:

- **Auto-registers** in AI Admin the first time it is seen (creates a *calling application* entry).
- **Auto-tags** the job if the job does not already belong to an application (groups it in the AI Admin UI).
- Appears in **diagnostic logs** so your team can filter by app.

Pick **one stable string per project** and use it in every Edge Function call. If you have separate staging and production projects, use different names (e.g. `lovable:marketplace-staging`, `lovable:marketplace-prod`).

```ts
// Inside your Edge Function:
const CALLING_APP = 'lovable:marketplace-prod';   // ← change once, use everywhere

// Then pass it in every mode:
body.callingApplication = CALLING_APP;
```

**Anti-spoofing (optional):** Your admin can link an API key directly to a calling application in AI Admin. When this is configured, the server uses the key's linked identity and ignores the body field entirely — preventing any caller from impersonating another application. When no key link is configured, the body field is required and trusted.

---

## 2c. Per-user identity (`X-Forwarded-User-Id`)

When your Lovable app and AI Admin run on **separate Supabase projects**, end-user JWTs from your Lovable Supabase won't be valid at AI Admin. To preserve per-user identity (needed for MCP integrations, personal API keys, and access control), Edge Functions can **forward** the user's identity as a trusted header.

### How it works

1. Your Edge Function validates the Lovable user's Supabase JWT (server-side).
2. It sends the `aim_sk_` API key **plus** an `X-Forwarded-User-Id` header containing the user's Supabase UID.
3. AI Admin trusts this forwarded ID (because the `aim_sk_` key is a server-side secret) and uses it for per-user credential lookup, MCP OAuth scoping, and access control.

### Two auth modes

| Mode | Headers | When to use |
|------|---------|-------------|
| **User-context** | `Authorization: Bearer aim_sk_…` + `X-Forwarded-User-Id: <uid>` | Chat sessions with MCP tools, per-user OAuth, profiles that require personal credentials |
| **App-context** | `Authorization: Bearer aim_sk_…` (no user header) | Background jobs, public completions, anything that doesn't need per-user identity |

### Security

- `X-Forwarded-User-Id` is **only trusted** when presented with a valid `aim_sk_` API key.
- The header is **ignored** in JWT auth mode (the JWT's own userId always takes precedence).
- The `aim_sk_` key must **never** be exposed to browsers — keep it in Edge Function secrets only.
- Edge Function code **must** validate the user's Lovable Supabase JWT before forwarding the ID.

---

## 3. Completion (one-shot) vs streaming chat

### Completion / one-shot

- You send **one request**; you get back **one JSON body** (or an error JSON).
- Good for: classify, summarize, generate structured output, run a **Processing Job** with **variables**.
- Typical paths (proxied by Edge Function modes — see §4 below):
  - **Ad-hoc prompt + profile** → `POST /api/ai-matcher/run-slot`
  - **Templated job** → `POST /api/processing-jobs/:jobId/test` with `{ "variables": { ... } }`

### Streaming chat

- You **open a session** (JSON response with a `sessionId`).
- Each **user message** returns **`text/event-stream` (SSE)** — many small chunks until the model finishes.
- Good for: chat UIs, typing indicators, long answers.
- Paths:
  - `POST /api/chat-sessions` — create session
  - `POST /api/chat-sessions/:sessionId/messages` — send message, **response is SSE**

**Lovable / browser note:** `supabase.functions.invoke()` is built for **JSON**. For SSE, use **`fetch`** to your Edge Function URL with the Supabase **anon key** in `Authorization: Bearer <anon>` and `apikey` header as per Supabase docs, **or** implement a small Edge Function that buffers the stream and returns JSON (loses live typing but easier to test).

---

## 4. Edge Function modes (reference implementation)

> **Summary:** Complete reference for all Edge Function modes — completion, chat, credentials, OAuth, and session management.

The downloadable `ai-admin-supabase-edge-function.ts` implements every mode below. Each mode is a JSON body with `{ "mode": "<name>", ... }`.

### Auth context on every request

The Edge Function **always** sends the `aim_sk_` API key. Some modes also need the end-user's identity — the function validates the Lovable Supabase JWT and adds `X-Forwarded-User-Id` (see §2c). The table below marks which modes require it.

| Mode | Category | User identity required? |
|------|----------|------------------------|
| `ask-ai-profile` | Completion | No |
| `run-processing-job` | Completion | No |
| `open-chat-session` | Chat | **Yes** (for MCP / personal-credential profiles) |
| `send-chat-message-stream` | Chat | **Yes** (forwarded from session, but include for consistency) |
| `list-chat-files` | Chat / Files | **Yes** |
| `list-chat-sessions` | Chat / History | **Yes** |
| `get-chat-session` | Chat / History | **Yes** |
| `submit-tool-outputs` | Chat | **Yes** |
| `store-user-credential` | Credentials | **Yes** |
| `check-tool-auth` | MCP / OAuth | **Yes** |
| `initiate-tool-oauth` | MCP / OAuth | **Yes** |

When user identity is required, the Edge Function must:
1. Extract the Lovable user's JWT from the incoming request.
2. Validate it with `supabase.auth.getUser()`.
3. Add `X-Forwarded-User-Id: <user.id>` to the upstream AI Admin request.

If the mode is called **without** a valid user JWT when user identity is required, the Edge Function should return `401` before reaching AI Admin.

### Test contracts per mode

Each mode has a minimum set of test cases that MUST pass. Use these to verify your Edge Function implementation.

| Mode | Test | Expected |
|------|------|----------|
| `ask-ai-profile` | No JWT | `401` from Edge Function |
| `ask-ai-profile` | Missing `profileId` | `400` with error message |
| `ask-ai-profile` | Valid request | Proxied JSON response with `raw` and/or `formatted` fields |
| `run-processing-job` | No JWT | `401` from Edge Function |
| `run-processing-job` | Missing `jobId` | `400` with error message |
| `run-processing-job` | Valid request | Proxied JSON response with `raw`, `formatted`, `messageSent` |
| `open-chat-session` | No JWT | `401` from Edge Function |
| `open-chat-session` | No identifier (no profileId/jobSlug/jobId) | `400` with error message |
| `open-chat-session` | Valid request | JSON with `sessionId`, `status: "active"` |
| `open-chat-session` | Valid with job that has rule sets | JSON includes `ruleSets` array |
| `send-chat-message-stream` | No JWT | `401` from Edge Function |
| `send-chat-message-stream` | Missing `sessionId` | `400` with error message |
| `send-chat-message-stream` | No trigger (`message`, `stepKey`, or `ruleSetKey`) | `400` with error message |
| `send-chat-message-stream` | Session already processing another message | `409` with `{ "error": "Session is currently processing..." }` — wait for `[DONE]` and retry |
| `send-chat-message-stream` | Valid `message` | SSE stream with content deltas and `[DONE]` |
| `send-chat-message-stream` | Valid `ruleSetKey` + `variables` | SSE stream with template-interpolated response |
| `store-user-credential` | No JWT | `401` from Edge Function |
| `store-user-credential` | Valid `providerId` + `apiKey` | `200` success |
| `check-tool-auth` | No JWT | `401` from Edge Function |
| `check-tool-auth` | Valid `profileId` + `toolId` | JSON with `hasToken` boolean |
| `list-chat-sessions` | No JWT | `401` from Edge Function |
| `list-chat-sessions` | Valid request (no filters) | JSON array of session objects for the authenticated user |
| `list-chat-sessions` | Valid with `status: "active"` filter | JSON array filtered to active sessions only |
| `get-chat-session` | No JWT | `401` from Edge Function |
| `get-chat-session` | Missing `sessionId` | `400` with error message |
| `get-chat-session` | Valid `sessionId` | JSON with session metadata, `messages` array, and `stats` object |
| `get-chat-session` | `sessionId` owned by a different user | `403` forbidden |
| `submit-tool-outputs` | No JWT | `401` from Edge Function |
| `submit-tool-outputs` | Valid `sessionId` + `systemMessageId` + `outputs` | SSE stream with AI continuation |

---

### `ask-ai-profile` (completion)

**Body:**

```json
{
  "mode": "ask-ai-profile",
  "prompt": "Your question or instruction in plain text.",
  "profileId": "<UUID from AI Admin → Profiles>",
  "formattingRules": [],
  "attachments": [
    { "url": "https://…signed-url…", "mimeType": "text/csv", "fileName": "data.csv" }
  ]
}
```

`attachments` is optional. When present, text-based files are downloaded and prepended to the prompt. See §9 for details.

**Upstream:** `POST /api/ai-matcher/run-slot` with `{ "prompt", "slot": { "type": "profile", "profileId" }, "formattingRules", "attachments?" }`.

**Auth context:** App-context only (no `X-Forwarded-User-Id`).

---

### `run-processing-job` (completion)

**Body:**

```json
{
  "mode": "run-processing-job",
  "jobId": "<UUID from AI Admin → Jobs>",
  "callingApplication": "lovable:your-project-name",
  "variables": {
    "fieldNameFromTemplate": "value"
  },
  "attachments": [
    { "url": "https://…signed-url…", "mimeType": "text/csv", "fileName": "report.csv" }
  ]
}
```

`attachments` is optional. Text-based files are downloaded and injected into the prompt before the template variables. See §9 for details.

**Upstream:** `POST /api/processing-jobs/:jobId/test` with `{ "variables", "attachments?" }`.

Variable **keys** must match placeholders your job's prompt template expects (`{{variableName}}` in the template).

**Auth context:** App-context only (no `X-Forwarded-User-Id`).

---

### Creating and managing jobs (UI or API)

Your app can **create, update, list, and delete** processing jobs programmatically — no manual UI steps required. This is the recommended approach: your codebase becomes the source of truth for job definitions.

#### API endpoints for job management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/processing-jobs` | Create a new job |
| `GET` | `/api/processing-jobs` | List all jobs in the workspace |
| `GET` | `/api/processing-jobs/:id` | Get a single job by ID |
| `PUT` | `/api/processing-jobs/:id` | Update an existing job |
| `DELETE` | `/api/processing-jobs/:id` | Delete a job |

**Auth:** `aim_sk_…` API key (any role including `member`). No JWT or `X-Workspace-Id` needed when using an API key.

#### API endpoints for AI profiles

Your app needs an `ai_profile_id` when creating a job. Use these endpoints to discover available profiles:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ai-profiles` | List all profiles in the workspace |
| `GET` | `/api/ai-profiles/:id` | Get a single profile by ID |

Each profile has `id`, `name`, `mode` (`"completion"` or `"chat"`), and `profile_type` (`"model"` or `"agent"`). For one-shot structured output jobs, pick a profile where `mode === "completion"`.

**Auth:** Same as jobs — `aim_sk_…` API key (any role).

#### Edge Function example — create a processing job

Your Lovable app should create its own Edge Function (or add a mode to an existing one) to manage jobs. Here is a complete example:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const AI_ADMIN_API_KEY = Deno.env.get("AI_ADMIN_API_KEY")!;
const rawBase = Deno.env.get("AI_ADMIN_BASE_URL") ?? "";
const AI_ADMIN_BASE_URL = rawBase.includes("/_/backend")
  ? rawBase.replace(/\/+$/, "")
  : rawBase.includes("localhost")
    ? rawBase.replace(/\/+$/, "")
    : rawBase.replace(/\/+$/, "") + "/_/backend";

serve(async (req) => {
  const { action, ...payload } = await req.json();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AI_ADMIN_API_KEY}`,
  };

  if (action === "create-job") {
    // POST /api/processing-jobs — create a new job
    const res = await fetch(`${AI_ADMIN_BASE_URL}/api/processing-jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: payload.name,
        slug: payload.slug,
        ai_profile_id: payload.aiProfileId,
        config: payload.config,
      }),
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "update-job") {
    // PUT /api/processing-jobs/:id — update an existing job
    const res = await fetch(
      `${AI_ADMIN_BASE_URL}/api/processing-jobs/${payload.jobId}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(payload.updates),
      }
    );
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "list-jobs") {
    // GET /api/processing-jobs — list all jobs
    const res = await fetch(`${AI_ADMIN_BASE_URL}/api/processing-jobs`, {
      headers,
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "list-profiles") {
    // GET /api/ai-profiles — list available AI profiles
    const res = await fetch(`${AI_ADMIN_BASE_URL}/api/ai-profiles`, {
      headers,
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Unknown action" }), {
    status: 400,
  });
});
```

**From Lovable (React):**

```typescript
const { data } = await supabase.functions.invoke("manage-ai-jobs", {
  body: {
    action: "create-job",
    name: "Breakout Zhuzh — Content Suggestions",
    slug: "breakout-zhuzh",
    aiProfileId: "<your-profile-uuid>",
    config: {
      promptTemplate: "Given this session: {{context}}, suggest 3 options...",
      variables: [
        { name: "context", label: "Session context", source: "pipeline" },
      ],
    },
  },
});
const jobId = data.id; // use this to run the job later
```

#### Alternative: edit jobs in the AI Admin UI

You can also edit **prompt template**, **formatting rules**, **template variables**, **default test values** (`testData`), and **expected response schema** (`expectedSchema`) under **AI Admin → Jobs → Build Rules**. Saving updates the same `config` object the API uses.

- **API (recommended for apps):** Create or update jobs with `POST /api/processing-jobs` or `PUT /api/processing-jobs/:id` (Bearer JWT or `aim_sk_…` API key; include `X-Workspace-Id` when using a JWT). Any authenticated user (including `member`-role API keys) can manage jobs — no `admin` role required. Send a `config` object so your Lovable / Edge Function repo stays the source of truth.

**Example `config` shape** (merge with existing keys as needed):

```json
{
  "promptTemplate": "Write one sentence about {{topic}} in a {{tone}} tone.",
  "formattingRules": [],
  "variables": [
    { "name": "topic", "label": "Topic", "source": "user" },
    { "name": "tone", "label": "Tone", "source": "user" }
  ],
  "testData": {
    "topic": "renewable energy",
    "tone": "brief"
  },
  "expectedSchema": {
    "fields": {
      "summary": {
        "type": "string",
        "required": true,
        "description": "One-line summary"
      }
    }
  }
}
```

Field definitions under `expectedSchema.fields` may include `type` (`string`, `array`, `object`, …), `required`, `description`, and optionally `allowedValues` / `suggestedValues`. The admin **Test** tab uses this schema to validate formatted JSON when present.

`PUT` **deep-merges** `config`: nested objects merge; top-level keys like `variables` or `formattingRules` are replaced by the array/object you send for that key—send the full list you want stored.

> **⚠ Snake_case column names required.** The `PUT /api/processing-jobs/:id` endpoint passes your JSON body directly to the database — there is **no** camelCase-to-snake_case transformation. You **MUST** use database column names:
>
> | You might try (wrong) | Correct column name |
> |----------------------|---------------------|
> | `aiProfileId` | `ai_profile_id` |
> | `isActive` | `is_active` |
> | `callingApplication` | `calling_application` |
>
> Sending a camelCase key like `aiProfileId` writes to a non-existent column, which causes a **500 error** with no helpful message. The `config` field is the exception — it's a JSONB column, so keys inside `config` (like `promptTemplate`, `formattingRules`, `ruleSets`) use camelCase because they are application-defined, not database columns.
>
> **Example — change a job's AI profile:**
> ```json
> PUT /api/processing-jobs/<job-uuid>
> { "ai_profile_id": "<new-profile-uuid>" }
> ```

### Sample jobs (create via API or AI Admin UI)

Use a profile that supports **completion**-style jobs so the **Build Rules** tab is available (some chat-only setups limit that tab).

**Job 1 — fixed (no variables)**
- **Name:** `Lovable test — fixed` · **Slug:** `lovable-test-fixed`
- **Build Rules → Prompt Template:**
  ```
  Reply with exactly the word SMOKE_OK and nothing else.
  ```
- **Lovable / Edge Function:** `variables: {}`
- **Success for humans:** the app shows **SMOKE_OK**.

**Job 2 — two variables (`topic`, `tone`)**
- **Name:** `Lovable test — variables` · **Slug:** `lovable-test-vars`
- **Prompt Template:**
  ```
  Write one friendly sentence about {{topic}}. Keep the style {{tone}}.
  ```
- **Build Rules (optional but useful):** Use **Suggest from template** (or add variables manually), set **default test values** for `topic` / `tone`, and add an **expected response schema** if you want schema checks in the Test tab.
- **Lovable body:** `variables: { "topic": "renewable energy", "tone": "brief" }` (keys = slot names, no `{{ }}`).
- **Success for humans:** one sentence that clearly reflects **topic** and **tone**.

### Writing prompts that return structured JSON

When your app needs to parse the AI's response (not just display it), the prompt must instruct the LLM to return valid JSON with field names your code expects. There is no separate "JSON mode" — the prompt itself is the only mechanism.

**Pattern: End the prompt with the exact JSON shape you expect.**

Place the schema at the very end so it's the last thing the LLM sees. Use placeholder values that communicate the expected type:

```
[Your task instructions here...]

Respond with ONLY the following JSON — no markdown, no explanation, no extra text:

{
  "field_name": "string value",
  "score": 0,
  "items": ["item1", "item2"],
  "is_valid": true
}
```

**Rules:**

1. **Say "ONLY the following JSON" explicitly.** Without this, LLMs wrap JSON in markdown code fences or add text before/after, which breaks `JSON.parse()`.

2. **Field names must match what your code expects.** If your app reads `response.sources`, the schema must use `"sources"` as the key.

3. **Show the data types with example values.** Use `"string"` for strings, `0` for numbers, `["a", "b"]` for arrays, `true`/`false` for booleans. For arrays of objects, show 2-3 items so the LLM understands the element shape:

```
"sources": [
  { "name": "Example", "url": "https://...", "score": 8 },
  { "name": "Another", "url": "https://...", "score": 7 }
]
```

4. **Set `expectedResponseFormat: "json"` on the job config.** This tells AI Admin to apply JSON-aware formatting (strip markdown fences, extract JSON from surrounding text) before your app receives the response.

**Complete example — a job whose response your app parses:**

```
POST /api/processing-jobs
{
  "name": "Analyze Sentiment",
  "slug": "analyze-sentiment",
  "ai_profile_id": "<uuid>",
  "config": {
    "promptTemplate": "Analyze the sentiment of this customer review:\n\n{{review}}\n\nRespond with ONLY the following JSON — no markdown, no explanation, no extra text:\n\n{\n  \"sentiment\": \"positive | negative | neutral\",\n  \"confidence\": 0.0,\n  \"key_phrases\": [\"phrase1\", \"phrase2\"],\n  \"summary\": \"One sentence summary of the review.\"\n}",
    "expectedResponseFormat": "json"
  }
}
```

Your app sends `variables: { "review": "The product is amazing..." }` and reads `data.formatted` or `data.raw`, then parses it as JSON to get `sentiment`, `confidence`, etc.

**When you DON'T need JSON:** If the user just sees the AI's response as text (chat, summaries, creative writing), skip the JSON schema entirely and write a natural prompt.

---

### `open-chat-session` (streaming — step 1)

**Body (one of profile / job slug / job id / workflow slug / workflow id):**

```json
{
  "mode": "open-chat-session",
  "userId": "stable-id-per-end-user",
  "callingApplication": "lovable:your-project-name",
  "aiProfileId": "<optional UUID>",
  "jobSlug": "<optional slug>",
  "jobId": "<optional UUID>",
  "workflowSlug": "<optional slug>",
  "workflowId": "<optional UUID>",
  "systemPrompt": "<optional>"
}
```

**Upstream:** `POST /api/chat-sessions` with the same fields.

**Auth context:** User-context. The Edge Function validates the Lovable JWT, then sends `X-Forwarded-User-Id: <user.id>` so AI Admin can resolve per-user credentials and MCP tokens. The `userId` in the body is the same value (used by AI Admin for session metadata).

**Typical success JSON** (shape may include extra fields):

```json
{
  "sessionId": "uuid",
  "externalChatId": null,
  "providerType": "…",
  "status": "active",
  "aiProfileId": "uuid",
  "aiProfileName": "…",
  "workflowId": "uuid or null",
  "steps": [
    { "stepKey": "generate-timeline", "name": "Generate Timeline", "sortOrder": 0, "isRequired": true, "dependsOn": [] },
    { "stepKey": "generate-budget", "name": "Generate Budget", "sortOrder": 1, "isRequired": false, "dependsOn": ["generate-timeline"] }
  ],
  "ruleSets": [
    { "key": "analyze-company", "name": "Analyze Company", "description": "Runs the company ICP analysis prompt" },
    { "key": "generate-pitch", "name": "Generate Pitch", "description": null }
  ]
}
```

Save **`sessionId`** for the next call.

- When opened with a **workflow**, the response includes a `steps` array. See §10 for workflow documentation.
- When opened with a **chat-mode processing job**, the response includes a `ruleSets` array listing available rule set keys. See §11 for rule set documentation.

---

### `send-chat-message-stream` (streaming — step 2)

**Body (free-form message):**

```json
{
  "mode": "send-chat-message-stream",
  "sessionId": "<from open-chat-session>",
  "message": "User's message text.",
  "attachments": [
    { "url": "https://…signed-url…", "mimeType": "text/csv", "fileName": "data.csv" }
  ]
}
```

**Body (workflow step trigger — use instead of `message`):**

```json
{
  "mode": "send-chat-message-stream",
  "sessionId": "<from open-chat-session>",
  "stepKey": "generate-timeline",
  "variables": { "productName": "My App", "launchDate": "2026-06-01" }
}
```

When `stepKey` is provided, AI Admin looks up the workflow step's processing job, interpolates the prompt template with the given `variables`, and sends the constructed prompt in the chat. See §10 for the full workflow documentation.

**Body (rule set invocation — use instead of `message`):**

```json
{
  "mode": "send-chat-message-stream",
  "sessionId": "<from open-chat-session>",
  "ruleSetKey": "analyze-company",
  "variables": { "companyName": "HubSpot", "domain": "hubspot.com" }
}
```

When `ruleSetKey` is provided, AI Admin looks up the named rule set from the session's linked processing job (`config.ruleSets`), interpolates the prompt template, applies the rule set's formatting rules to the response stream, and records the `rule_set_key` on the message for traceability. See §11 for the full rule sets documentation.

> **Sequencing requirement (server-enforced):** You MUST wait for the SSE stream to complete (`data: [DONE]`) before sending the next message on the same session. AI Admin enforces this server-side — sending a second message while the first is still streaming returns **`409 Conflict`** with `{ "error": "Session is currently processing another message..." }`. Your client MUST disable the send button (or equivalent trigger) while a stream is active, and handle 409 gracefully if it occurs. See §11 "Rule set invocations MUST be sequential" for details and the "Avoiding and handling 409" section below for best practices.

`attachments` is optional and works with free-form messages, step triggers, and rule set invocations. Files are uploaded to the AI provider and included alongside the message. See §9 for supported types.

**Upstream:** `POST /api/chat-sessions/:sessionId/messages` with `{ "message"?, "stepKey"?, "ruleSetKey"?, "variables"?, "attachments"? }`.

**Auth context:** User-context. Include `X-Forwarded-User-Id` for consistency (the session already knows the user, but the header ensures credential resolution works on every request).

**Response:** `Content-Type: text/event-stream`. Body is SSE: lines like `data: {…}` and possibly `data: [DONE]`. The Edge Function **proxies** this stream; the client should use **`fetch` + `ReadableStream`** (or similar), not `invoke()` if you need true streaming.

**Timeout:** SSE connections have a **5-minute server-side timeout**. If an upstream LLM hangs or an agent task takes longer, the server sends a `timeout` event and closes the connection. Your client should handle this gracefully (show a "timed out" message and allow retry).

**MCP tool events:** During streaming, the AI may emit `tool.call` events when it uses MCP tools. See §6 for the complete SSE event reference (every event type, JSON shapes, and a production-ready TypeScript parser), and §8 for MCP setup and per-user credential flows.

---

### `list-chat-files` (retrieve files from a chat session)

List all files in a chat session — both user-uploaded attachments and AI-generated files. Use this to build a file gallery or download page after a conversation.

**Body:**

```json
{
  "mode": "list-chat-files",
  "sessionId": "<chat session ID>"
}
```

**Upstream:** `GET /api/chat-sessions/:sessionId/files`.

**Auth context:** User-context **required**.

**Typical success JSON:**

```json
{
  "files": [
    {
      "id": "file-id",
      "source": "USER",
      "filename": "data.csv",
      "size": 2048,
      "mimeType": "text/csv",
      "url": "https://…public-blob-url…",
      "status": "UPLOADED"
    },
    {
      "id": "file-id-2",
      "source": "SYSTEM",
      "filename": "analysis.csv",
      "size": 512,
      "mimeType": "text/csv",
      "url": "https://…public-blob-url…",
      "status": "UPLOADED"
    }
  ]
}
```

Files with `source: "USER"` were uploaded by the caller; `source: "SYSTEM"` means AI-generated. URLs are publicly accessible (Vercel Blob Storage) — no auth needed to download.

---

### `list-chat-sessions` (retrieve the user's chat sessions)

List all chat sessions for the authenticated user. Use this to build a conversation history UI, let users resume past chats, or display session metadata.

**Body:**

```json
{
  "mode": "list-chat-sessions",
  "aiProfileId": "(optional) filter to sessions for a specific AI profile",
  "status": "(optional) filter by status: active | closed",
  "callingApplication": "(optional) filter to sessions created by a specific app"
}
```

All filter fields are optional. Omit them to retrieve all sessions for the user.

**Upstream:** `GET /api/chat-sessions?aiProfileId=...&status=...&callingApplication=...`. The Edge Function adds `X-Forwarded-User-Id` so the backend automatically scopes results to the authenticated user.

**Auth context:** User-context **required**.

**Typical success JSON:**

```json
[
  {
    "id": "d47d0970-eb46-40c5-ae9e-56ee527a0de1",
    "user_id": "user-uuid",
    "ai_profile_id": "94d8b160-0861-4959-a5d1-d7555448ddcf",
    "processing_job_id": "025b417c-e05f-4d26-aeb1-7adae19883dc",
    "workflow_id": null,
    "status": "active",
    "calling_application": "my-lovable-app",
    "message_count": 12,
    "total_prompt_tokens": 4500,
    "total_completion_tokens": 3200,
    "created_at": "2026-04-01T10:30:00.000Z",
    "updated_at": "2026-04-07T14:22:00.000Z",
    "ai_profile": { "id": "94d8b160-...", "name": "AI XP Launch Playbook Agent" }
  }
]
```

Results are ordered by `updated_at` descending (most recently active first), limited to 200 sessions.

---

### `get-chat-session` (retrieve a single session with messages and stats)

Retrieve full details for a specific chat session — metadata, the complete message history, and aggregated performance stats. Use this to restore a conversation, display a chat transcript, or show session analytics.

**Body:**

```json
{
  "mode": "get-chat-session",
  "sessionId": "<chat session ID>"
}
```

**Upstream:** `GET /api/chat-sessions/:sessionId`. The backend enforces ownership — API-key callers with `X-Forwarded-User-Id` can only access sessions where `user_id` matches.

**Auth context:** User-context **required**.

**Typical success JSON:**

```json
{
  "id": "d47d0970-eb46-40c5-ae9e-56ee527a0de1",
  "user_id": "user-uuid",
  "ai_profile_id": "94d8b160-0861-4959-a5d1-d7555448ddcf",
  "processing_job_id": "025b417c-e05f-4d26-aeb1-7adae19883dc",
  "status": "active",
  "calling_application": "my-lovable-app",
  "message_count": 4,
  "created_at": "2026-04-01T10:30:00.000Z",
  "updated_at": "2026-04-07T14:22:00.000Z",
  "ai_profile": {
    "id": "94d8b160-...",
    "name": "AI XP Launch Playbook Agent",
    "external_ai_id": "cmn...",
    "mode": "chat"
  },
  "messages": [
    {
      "id": "msg-uuid-1",
      "role": "user",
      "content": "I need a playbook for MSP partner onboarding.",
      "created_at": "2026-04-01T10:31:00.000Z",
      "rule_set_key": "discover_sources",
      "prompt_tokens": null,
      "completion_tokens": null,
      "duration_ms": null
    },
    {
      "id": "msg-uuid-2",
      "role": "assistant",
      "content": "I found several relevant sources in your connected accounts...",
      "created_at": "2026-04-01T10:31:12.000Z",
      "rule_set_key": null,
      "prompt_tokens": 1200,
      "completion_tokens": 850,
      "duration_ms": 4300
    }
  ],
  "stats": {
    "messageCount": 4,
    "assistantMessageCount": 2,
    "avgResponseMs": 4150,
    "avgFirstTokenMs": 620,
    "totalPromptTokens": 2400,
    "totalCompletionTokens": 1700,
    "totalTokens": 4100
  }
}
```

The `messages` array is ordered chronologically (oldest first). The `stats` object aggregates performance metrics across all assistant messages in the session.

---

### `submit-tool-outputs` (chat — respond to tool.call events)

When the AI emits a `tool.call` event that requires user input (e.g. confirming an action, providing additional info), your app submits the response with this mode.

**Body:**

```json
{
  "mode": "submit-tool-outputs",
  "sessionId": "<chat session ID>",
  "systemMessageId": "<message ID from the tool.call event>",
  "outputs": [
    { "toolCallId": "<from the tool.call event>", "output": "user's response or confirmation" }
  ]
}
```

**Upstream:** `POST /api/chat-sessions/:sessionId/tool-outputs` with `{ "systemMessageId", "outputs" }`.

**Auth context:** User-context. Include `X-Forwarded-User-Id`.

**Response:** SSE stream (same format as `send-chat-message-stream`). The AI processes the outputs and continues the conversation.

---

### `store-user-credential` (save a user's personal API key)

Before a user can access MCP tools (Gmail, Drive, etc.), they need a personal Devs.ai API key stored in AI Admin. Your Lovable app collects the key and forwards it through the Edge Function.

**Body:**

```json
{
  "mode": "store-user-credential",
  "providerId": "<UUID of the Devs.ai provider in AI Admin>",
  "apiKey": "<the user's personal Devs.ai API key>",
  "label": "My Devs.ai key"
}
```

**Upstream:** `POST /api/user-credentials` with `{ "providerId", "apiKey", "label" }`.

**Auth context:** User-context **required**. The Edge Function validates the Lovable JWT and sends `X-Forwarded-User-Id`. AI Admin stores the key encrypted (AES-256-GCM) and associates it with that user ID.

**Typical success JSON:**

```json
{
  "id": "uuid",
  "userId": "user-uid",
  "providerId": "provider-uuid",
  "label": "My Devs.ai key",
  "createdAt": "…",
  "updatedAt": "…"
}
```

The `apiKey` is **never** returned in responses.

---

### `check-tool-auth` (check MCP OAuth status for a user)

Check whether a specific MCP tool (e.g. Google Services) has a valid OAuth token for this user.

**Body:**

```json
{
  "mode": "check-tool-auth",
  "profileId": "<AI profile UUID>",
  "toolId": "<MCP tool UUID from tool discovery>"
}
```

**Upstream:** `GET /api/ai-profiles/:profileId/tools/:toolId/oauth-status`.

**Auth context:** User-context **required**. OAuth tokens are scoped per-user via their personal Devs.ai account.

**Typical success JSON:**

```json
{
  "hasToken": true,
  "scopes": "https://www.googleapis.com/auth/gmail.readonly ..."
}
```

Use `hasToken` to decide whether to show a "Connect" button or a "Connected" badge in your UI.

---

### `initiate-tool-oauth` (start OAuth flow for an MCP tool)

Get the OAuth authorization URL for an MCP tool. Your app redirects (or opens a popup for) the user to complete the consent flow.

**Body:**

```json
{
  "mode": "initiate-tool-oauth",
  "profileId": "<AI profile UUID>",
  "toolId": "<MCP tool UUID>"
}
```

**Upstream:** `POST /api/ai-profiles/:profileId/tools/:toolId/oauth-initiate`.

**Auth context:** User-context **required**. The OAuth flow is tied to the user's personal Devs.ai account.

**Typical success JSON:**

```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

Redirect the user to `authUrl`. After they authorize, Devs.ai stores the OAuth token. Your app can call `check-tool-auth` to confirm the connection succeeded.

---

## 5. Interpreting JSON — completion responses

### Plain English: did it work?

You do **not** need to know what JSON is to validate the integration.

- **Success:** The app shows a **normal paragraph or sentence** from the AI — readable text. Behind the scenes the server sent a structured reply; the UI should **extract** the answer text and show it in a big, friendly area.
- **Failure:** A **short** message anyone can understand ("Couldn't reach the AI," "Something went wrong") — optional "Technical details" for developers.

### From `ai-matcher/run-slot` (`ask-ai-profile`)

Success-like payload often includes:

| Field | Meaning |
|-------|--------|
| `status` | Often `"success"` when the model ran; may be `"error"` with HTTP 200 in some cases — always check `error`. |
| `raw` | Raw model text string. |
| `formatted` | After formatting rules (may be `null` if no rules). Prefer showing **formatted** when non-null, else **raw**. |
| `error` | Human-readable error string when something failed. |
| `durationMs` | Time taken. |
| `model` | Model id used. |
| `provider` | Provider name. |
| `usage` | Token usage object when available. |
| `finishReason` | Provider finish reason when available. |

### From `processing-jobs/:id/test` (`run-processing-job`)

Typical fields:

| Field | Meaning |
|-------|--------|
| `messageSent` | The interpolated prompt sent to the model (useful for debugging). |
| `raw` | Raw model output. |
| `formatted` | Output after job formatting rules. |
| `formattingSteps` | Trace of formatting (optional UI). |
| `durationMs`, `model`, `usage`, `finishReason` | Same idea as above. |
| `diagnostics` | Extra debug info when present. |
| `error` | Top-level error in JSON when HTTP error. |

---

## 6. SSE Event Reference and Best Practices

> **Summary:** Definitive SSE event catalog, production parser, React integration, OAuth mid-stream, and tool call UX.

This section is the **definitive guide** to every SSE event your Lovable app can receive from AI Admin during a streaming chat. All code examples are React/TypeScript and designed for Lovable's architecture: your frontend reads the stream, your Supabase Edge Function proxies it, and AI Admin does the AI orchestration.

> **Architecture reminder:** Lovable generates frontend React/TS code. Supabase provides the backend (Edge Functions, database, secrets). Your Edge Function proxies AI Admin's SSE stream — it does **not** parse or transform it. All event handling happens in your React components.

### Quick visual test

- **Streaming works:** The assistant's reply **grows over time** — words appearing in sequence, like someone typing.
- **Not streaming:** The full reply appears in one instant. Check your `fetch` + `ReadableStream` wiring (see below).

### Why `fetch`, not `supabase.functions.invoke()`

Supabase's `invoke()` method **does not support streaming responses** — it waits for the entire response before returning. For SSE, you **must** use the browser's native `fetch` API pointed at your Edge Function URL:

```typescript
const EDGE_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-admin`;
```

Store `VITE_SUPABASE_URL` in your Lovable project's `.env` (or use the Supabase client's URL). The Edge Function name matches whatever you deployed (e.g. `ai-admin`). Your Supabase secrets (`AI_ADMIN_API_KEY`, `AI_ADMIN_BASE_URL`) stay in **Supabase Dashboard → Edge Functions → Secrets** — they never appear in frontend code.

---

### Event catalog

Every `data:` line in the SSE stream is one of the following. Lines that are not `data:` (e.g. blank lines, `event:` lines) can be ignored.

#### 1. Content delta (text)

The AI's response text, delivered incrementally. This is the most common event.

```json
{"choices":[{"delta":{"content":"Here is the analysis"},"index":0}]}
```

- **Path:** `choices[0].delta.content`
- **When:** Continuously during the AI's reply.
- **Your app:** Append the `content` string to the current assistant message bubble. This creates the typing effect.

#### 2. `tool.call` — AI is invoking an MCP tool

```json
{"type":"tool.call","toolCallId":"tc_abc123","name":"google_services.gmail_search","arguments":{"query":"invoices from:accounting","maxResults":15}}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"tool.call"` | Event discriminator |
| `toolCallId` | string | Unique ID for this tool invocation |
| `name` | string | Fully qualified tool name (e.g. `google_services.gmail_search`) |
| `arguments` | object | Arguments passed to the tool |

- **When:** The AI decides to use an MCP tool (Gmail search, Drive file read, Calendar lookup, etc.).
- **Your app:** Show an activity indicator. See "Tool Call Visibility" below for UX options.

#### 3. `tool.result` — Tool execution finished

```json
{"type":"tool.result","toolCallId":"tc_abc123","output":"{\"messages\":[...]}"}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"tool.result"` | Event discriminator |
| `toolCallId` | string | Matches the originating `tool.call` |
| `output` | string | Tool output (often stringified JSON) |

- **When:** After the tool finishes executing.
- **Your app:** Update or dismiss the activity indicator for this `toolCallId`.

#### 4. `tool.message` — Informational / OAuth prompt

```json
{"type":"tool.message","toolCallId":"tc_xyz789","output":"{\"requiresUserAction\":true,\"authUrl\":\"https://accounts.google.com/o/oauth2/…\",\"message\":\"Please authorize Google access\"}","requiresUserAction":true}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"tool.message"` | Event discriminator |
| `toolCallId` | string | Related tool call |
| `output` | string | Stringified JSON — parse it to check for `authUrl`, `files`, etc. |
| `requiresUserAction` | boolean | If `true`, the conversation is paused until you call `submit-tool-outputs` |

- **When:** A tool needs user action (most commonly: OAuth authorization for Google, Slack, etc.).
- **Your app:** Parse `output` as JSON. If it contains `authUrl`, show an "Authorize" button or open the URL. See "OAuth Auth Link Handling" below.

#### 5. `suggested_actions` — AI suggests follow-up actions

```json
{"type":"tool.call","toolCallId":"tc_sa_001","name":"suggested_actions","arguments":{"actions":[{"label":"View meeting notes","action":"show_notes"},{"label":"Search for related emails","action":"search_emails"},{"label":"Create summary document","action":"create_doc"}]}}
```

- **When:** After the AI finishes a response, it may suggest follow-up actions the user might want.
- **Your app:** Render these as clickable chips or buttons below the AI's message. When clicked, send a new free-form message with the action's context (e.g. "Search for related emails"). See "Suggested Actions Handling" below.

#### 6. `files` — AI-generated files (synthetic)

```json
{"type":"files","files":[{"id":"abc123","filename":"report.csv","url":"https://…","mimeType":"text/csv","size":"2048 bytes"}]}
```

- **Injected by AI Admin** (not raw from the provider) when a tool produces files.
- **Your app:** Show download links or inline previews. See §9 for details.

#### 7. `usage` — Token counts (synthetic)

```json
{"type":"usage","prompt_tokens":1250,"completion_tokens":890,"total_tokens":2140,"model":"gpt-5.2"}
```

- **Injected by AI Admin** after streaming completes, before `[DONE]`.
- **Your app:** Optionally display token usage or store it for analytics. Not user-facing in most apps.

#### 8. `[DONE]` — Stream termination

```
data: [DONE]
```

- **When:** The stream is complete. No more events will follow.
- **Your app:** Finalize the assistant message, parse structured responses (JSON) if expected, and re-enable the input field.

---

### Production-quality SSE parser

Drop this into your Lovable project as a utility. It handles all event types, edge cases (partial chunks, multi-line buffers), and provides typed callbacks.

```typescript
// src/lib/ai-admin-sse.ts

export interface ContentDeltaEvent {
  type: 'content.delta';
  content: string;
}
export interface ToolCallEvent {
  type: 'tool.call';
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface ToolResultEvent {
  type: 'tool.result';
  toolCallId: string;
  output: string;
}
export interface ToolMessageEvent {
  type: 'tool.message';
  toolCallId: string;
  output: string;
  requiresUserAction: boolean;
  parsedOutput: Record<string, unknown> | null;
}
export interface SuggestedActionsEvent {
  type: 'suggested.actions';
  actions: Array<{ label: string; action: string }>;
}
export interface FilesEvent {
  type: 'files';
  files: Array<{ id: string; filename: string; url: string; mimeType: string; size: string }>;
}
export interface UsageEvent {
  type: 'usage';
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  model: string | null;
}
export interface DoneEvent {
  type: 'done';
}

export type AiAdminSSEEvent =
  | ContentDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolMessageEvent
  | SuggestedActionsEvent
  | FilesEvent
  | UsageEvent
  | DoneEvent;

export interface SSECallbacks {
  onContentDelta?: (event: ContentDeltaEvent) => void;
  onToolCall?: (event: ToolCallEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onToolMessage?: (event: ToolMessageEvent) => void;
  onSuggestedActions?: (event: SuggestedActionsEvent) => void;
  onFiles?: (event: FilesEvent) => void;
  onUsage?: (event: UsageEvent) => void;
  onDone?: (event: DoneEvent) => void;
  onError?: (error: Error) => void;
}

function classifyEvent(parsed: Record<string, unknown>): AiAdminSSEEvent | null {
  const eventType = parsed.type as string | undefined;

  if (eventType === 'tool.call') {
    // suggested_actions arrives as a tool.call with name "suggested_actions"
    if (parsed.name === 'suggested_actions') {
      const args = parsed.arguments as Record<string, unknown> | undefined;
      const actions = (args?.actions ?? []) as Array<{ label: string; action: string }>;
      return { type: 'suggested.actions', actions };
    }
    return {
      type: 'tool.call',
      toolCallId: parsed.toolCallId as string,
      name: parsed.name as string,
      arguments: (parsed.arguments ?? {}) as Record<string, unknown>,
    };
  }

  if (eventType === 'tool.result' || eventType === 'tool_calls') {
    return {
      type: 'tool.result',
      toolCallId: parsed.toolCallId as string,
      output: (parsed.output ?? '') as string,
    };
  }

  if (eventType === 'tool.message') {
    const rawOutput = (parsed.output ?? '') as string;
    let parsedOutput: Record<string, unknown> | null = null;
    try { parsedOutput = JSON.parse(rawOutput); } catch { /* not JSON */ }
    return {
      type: 'tool.message',
      toolCallId: parsed.toolCallId as string,
      output: rawOutput,
      requiresUserAction: !!parsed.requiresUserAction || !!parsedOutput?.requiresUserAction,
      parsedOutput,
    };
  }

  if (eventType === 'files') {
    return {
      type: 'files',
      files: (parsed.files ?? []) as FilesEvent['files'],
    };
  }

  if (eventType === 'usage') {
    return {
      type: 'usage',
      promptTokens: (parsed.prompt_tokens ?? null) as number | null,
      completionTokens: (parsed.completion_tokens ?? null) as number | null,
      totalTokens: (parsed.total_tokens ?? null) as number | null,
      model: (parsed.model ?? null) as string | null,
    };
  }

  // Content delta — OpenAI-compatible shape
  const delta = (parsed as any)?.choices?.[0]?.delta?.content;
  if (typeof delta === 'string') {
    return { type: 'content.delta', content: delta };
  }

  // Content delta — generic string content
  if (typeof parsed.content === 'string' && parsed.content) {
    return { type: 'content.delta', content: parsed.content };
  }

  // Content delta — object content with text property
  if (typeof (parsed.content as any)?.text === 'string') {
    return { type: 'content.delta', content: (parsed.content as any).text };
  }

  return null;
}

/**
 * Stream an AI Admin SSE response and dispatch typed events.
 *
 * Usage:
 *   const response = await fetch(edgeFnUrl, { method: 'POST', ... });
 *   await streamAiAdminSSE(response, {
 *     onContentDelta: (e) => appendToMessage(e.content),
 *     onToolCall: (e) => showToolIndicator(e.name),
 *     onDone: () => finalizeMessage(),
 *   });
 */
export async function streamAiAdminSSE(
  response: Response,
  callbacks: SSECallbacks,
): Promise<string> {
  const body = response.body;
  if (!body) {
    callbacks.onDone?.({ type: 'done' });
    return '';
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();

        if (data === '[DONE]') {
          callbacks.onDone?.({ type: 'done' });
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          const event = classifyEvent(parsed);
          if (!event) continue;

          switch (event.type) {
            case 'content.delta':
              fullContent += event.content;
              callbacks.onContentDelta?.(event);
              break;
            case 'tool.call':
              callbacks.onToolCall?.(event);
              break;
            case 'tool.result':
              callbacks.onToolResult?.(event);
              break;
            case 'tool.message':
              callbacks.onToolMessage?.(event);
              break;
            case 'suggested.actions':
              callbacks.onSuggestedActions?.(event);
              break;
            case 'files':
              callbacks.onFiles?.(event);
              break;
            case 'usage':
              callbacks.onUsage?.(event);
              break;
            case 'done':
              callbacks.onDone?.(event);
              break;
          }
        } catch {
          // Non-JSON data line — skip
        }
      }
    }
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
  }

  return fullContent;
}
```

### Using the parser in a React component

```typescript
// Example: inside a chat component's send handler
import { streamAiAdminSSE, type ToolCallEvent, type ToolMessageEvent } from '@/lib/ai-admin-sse';

const EDGE_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-admin`;

async function sendMessage(sessionId: string, message: string, jwt: string) {
  const response = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      mode: 'send-chat-message-stream',
      sessionId,
      message,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to send message');
  }

  const fullText = await streamAiAdminSSE(response, {
    onContentDelta: (e) => {
      // Append to the assistant message in state (triggers re-render for typing effect)
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content: last.content + e.content }];
        }
        return [...prev, { role: 'assistant', content: e.content }];
      });
    },

    onToolCall: (e) => {
      setActiveTools((prev) => [...prev, {
        id: e.toolCallId,
        name: e.name,
        status: 'running',
        displayName: formatToolName(e.name),
      }]);
    },

    onToolResult: (e) => {
      setActiveTools((prev) =>
        prev.map((t) => t.id === e.toolCallId ? { ...t, status: 'done' } : t)
      );
    },

    onToolMessage: (e) => {
      if (e.requiresUserAction && e.parsedOutput?.authUrl) {
        setAuthPrompt({ url: e.parsedOutput.authUrl as string, toolCallId: e.toolCallId });
      }
    },

    onSuggestedActions: (e) => {
      setSuggestedActions(e.actions);
    },

    onFiles: (e) => {
      setGeneratedFiles((prev) => [...prev, ...e.files]);
    },

    onDone: () => {
      setIsStreaming(false);
      setActiveTools([]);
    },
  });

  return fullText;
}

// Helper: turn "google_services.gmail_search" into "Searching Gmail"
function formatToolName(name: string): string {
  const map: Record<string, string> = {
    'google_services.gmail_search': 'Searching Gmail',
    'google_services.gmail_get': 'Reading email',
    'google_services.calendar_list': 'Checking calendar',
    'google_services.drive_search': 'Searching Google Drive',
    'google_services.drive_get': 'Reading document',
    'google_services.docs_get': 'Reading Google Doc',
  };
  return map[name] ?? `Using ${name.split('.').pop()?.replace(/_/g, ' ')}`;
}
```

---

### Tool call visibility — UX guidance

When the AI uses MCP tools (Gmail, Drive, Calendar, etc.), your app decides how much to show the user. There is no single right answer — it depends on your users' expectations and the app's purpose. We recommend offering a **user-facing setting** so individuals can choose.

**Three display modes:**

| Mode | What the user sees | Best for |
|------|-------------------|----------|
| **Collapsed** (recommended default) | Brief activity indicator: "Searching Gmail..." with a spinner. Disappears when the tool finishes. | Most users — they want to know something is happening without the details |
| **Expanded** | Activity indicator + collapsible detail panel showing tool name, arguments, and result summary. | Power users, debugging, transparency-focused apps |
| **Hidden** | Nothing — tool calls are silently consumed, user only sees the final AI response. | Simple chat UIs where tool activity would be confusing |

**Presenting this as a user setting:**

```tsx
// Settings or chat preferences component
<Select
  label="Tool activity visibility"
  description="How much detail to show when the AI uses external tools"
  data={[
    { value: 'collapsed', label: 'Brief indicators (recommended)' },
    { value: 'expanded', label: 'Full details' },
    { value: 'hidden', label: 'Hidden' },
  ]}
  value={toolVisibility}
  onChange={setToolVisibility}
/>
```

**Rendering by mode:**

```tsx
function ToolActivityIndicator({ tool, mode }: { tool: ActiveTool; mode: string }) {
  if (mode === 'hidden') return null;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
      {tool.status === 'running' && <Spinner className="h-3 w-3" />}
      {tool.status === 'done' && <CheckIcon className="h-3 w-3 text-green-500" />}
      <span>{tool.displayName}</span>

      {mode === 'expanded' && (
        <Collapsible>
          <CollapsibleTrigger className="text-xs underline">details</CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="text-xs bg-muted p-2 rounded mt-1">
              {JSON.stringify(tool.arguments, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
```

---

### OAuth auth link handling (mid-stream)

When the AI needs access to a service the user hasn't authorized yet (e.g. Google), the stream pauses and emits a `tool.message` event with an `authUrl`. Your app must handle this to let the user authorize and resume the conversation.

**Detection and flow:**

```
1. Stream is running, AI tries to use Gmail
2. SSE: tool.message with requiresUserAction: true, output contains authUrl
3. → Your app shows "Authorize Google" button (or auto-opens in new tab)
4. → User completes OAuth in the popup/tab
5. → Your app calls submit-tool-outputs to resume
6. → Stream resumes with the tool result and AI continues
```

**Complete implementation:**

```tsx
function AuthPrompt({ authPrompt, sessionId, jwt, onResume }: {
  authPrompt: { url: string; toolCallId: string };
  sessionId: string;
  jwt: string;
  onResume: () => void;
}) {
  const handleAuthorize = () => {
    // Open OAuth in a popup — user completes consent, then closes it
    const popup = window.open(authPrompt.url, 'oauth', 'width=600,height=700');

    // Poll for popup close, then submit tool outputs to resume the conversation
    const interval = setInterval(async () => {
      if (!popup || popup.closed) {
        clearInterval(interval);
        await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-admin`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({
              mode: 'submit-tool-outputs',
              sessionId,
              systemMessageId: authPrompt.toolCallId,
              outputs: [{ toolCallId: authPrompt.toolCallId, output: 'authorized' }],
            }),
          },
        );
        onResume();
      }
    }, 500);
  };

  return (
    <div className="border rounded-lg p-4 bg-amber-50 my-2">
      <p className="text-sm font-medium">Authorization required</p>
      <p className="text-xs text-muted-foreground mt-1">
        The AI needs access to your Google account to continue. This is a one-time step.
      </p>
      <button
        onClick={handleAuthorize}
        className="mt-2 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
      >
        Authorize Google Access
      </button>
    </div>
  );
}
```

**Key points:**
- If the user has **already** authorized (most common after first use), this event never fires and the AI uses tools transparently.
- The `submit-tool-outputs` call uses your Edge Function — secrets and auth flow through Supabase, not the frontend.
- After OAuth completes, the SSE stream from `submit-tool-outputs` continues with the AI's response. Wire it through the same `streamAiAdminSSE` parser.

---

### Suggested actions handling

After the AI finishes a response, it may emit a `suggested_actions` event with follow-up actions the user might want. These arrive as a `tool.call` event with `name: "suggested_actions"` — the SSE parser above automatically classifies them as `suggested.actions` events.

**Rendering:**

```tsx
function SuggestedActions({ actions, onSelect }: {
  actions: Array<{ label: string; action: string }>;
  onSelect: (action: string) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {actions.map((a) => (
        <button
          key={a.action}
          onClick={() => onSelect(a.label)}
          className="px-3 py-1.5 text-sm border rounded-full hover:bg-muted transition-colors"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// In your chat component:
// When user clicks a suggested action, send it as a new message
function handleSuggestedAction(label: string) {
  setSuggestedActions([]);
  sendMessage(sessionId, label, jwt);
}
```

**Behavior notes:**
- Wait for user click — do not auto-execute suggested actions.
- Clear suggested actions when the user sends any new message (typed or clicked).
- These are hints from the AI, not commands. The user can ignore them entirely.

---

### AI-generated file events

When the AI generates files (CSV exports, documents, images), the stream includes a `files` event. This is a **synthetic event** injected by AI Admin — the raw provider sends file data inside `tool.message` output, and AI Admin extracts and reformats it for convenience.

```json
{"type":"files","files":[{"id":"abc123","filename":"report.csv","url":"https://…blob-url…","mimeType":"text/csv","size":"2048 bytes"}]}
```

Each file has: `id`, `filename`, `url` (publicly accessible download link), `mimeType`, and `size`. See §9 for full implementation guidance including file upload, download, and gallery components.

---

### Provider compatibility

These event types have different availability depending on the AI provider and profile mode:

| Event | Devs.ai Agent (chat mode) | Devs.ai Model (completion mode) | Google Gemini |
|-------|--------------------------|-------------------------------|---------------|
| Content delta | Yes | Yes | Yes |
| `tool.call` / `tool.result` | Yes (MCP tools) | No | No |
| `tool.message` (OAuth) | Yes | No | No |
| `suggested_actions` | Yes | No | No |
| `files` (synthetic) | Yes (from tool output) | No | No |
| `usage` (synthetic) | Yes | Yes | Yes |
| `[DONE]` | Yes | Yes | Yes |

**What this means for your app:**
- **All apps** need content delta + usage + done handling. That covers every provider.
- **MCP tool events** only appear when using a Devs.ai **agent** profile (the profile's `mode` is `"chat"` and it has MCP servers attached). If your app only uses model-based profiles, you can skip tool event handling entirely.
- **Future-proof:** If AI Admin adds providers with their own tool-call formats, the backend will normalize them into the same event shapes documented here. Code built against these types will not need to change.

---

## 7. Bootstrap checklist for Lovable

**End-to-end proof happens in Lovable.** Add a small **integration test page** in your Lovable project (e.g. "AI Admin — Integration Tests") that pastes job IDs, runs each job through your Edge Function, and shows the AI's answer in plain view. That uses the same Supabase secrets and code path as production. AI Admin's **Jobs → Test** tab is ideal while you **edit** prompts, variables, and schema — but it talks to the API directly and does **not** prove Supabase + Edge Function wiring.

**Your app can create jobs programmatically.** Use `POST /api/processing-jobs` from an Edge Function to create jobs on the fly — no manual UI step required (see §4 "Creating and managing jobs" for a full Edge Function example). You can also create jobs in the AI Admin UI under **Jobs** if you prefer. *Developers:* `POST /api/auth/bootstrap` only links users to workspaces; it does not create jobs.

### Basic integration (completion + chat)

1. AI Admin: **API key** created; at least one **AI profile**; processing jobs created either in the **AI Admin UI** or **programmatically via API** from your Edge Function (see §4) — note the **job UUIDs**.
2. Supabase: **Secrets** set; **Edge Function** deployed (use or extend `ai-admin-supabase-edge-function.ts`).
3. Lovable: **Supabase client** configured (same project).
4. **Job tests:** Run both jobs from your **Lovable test page** first. **Non-experts** judge success by what they **see** on screen (and, for the variable job, text that matches their inputs). Developers can expose optional "Technical details" (`messageSent`, `raw`, `formatted`).
5. **Optional streaming test:** The reply should **appear gradually** on screen; not pop in all at once.

### MCP tools + per-user credentials (Gmail, Drive, etc.)

If any of your AI profiles use MCP tools that access user data, there are additional setup steps:

6. **Admin:** In AI Admin, toggle **"Requires personal credentials"** on the relevant AI profile. This ensures users without a stored key get a clear error instead of using the shared org key for personal data.
7. **Admin:** Note the **Devs.ai provider UUID** (AI Admin → Settings → Providers) — your Lovable app needs this when calling `store-user-credential`.
8. **User onboarding (your Lovable app must build this):**
   a. Prompt the user to enter their personal **Devs.ai API key** → call `store-user-credential` mode.
   b. Call `check-tool-auth` to see which MCP tools need OAuth authorization.
   c. For any tool with `hasToken: false`, call `initiate-tool-oauth` and redirect the user to the returned `authUrl`.
   d. After the user completes OAuth, call `check-tool-auth` again to confirm `hasToken: true`.
9. **Test MCP chat:** Open a chat session with the MCP-enabled profile and send a message that triggers tool use (e.g. "Search my Gmail for invoices from last month"). The SSE stream should show `tool.call` events followed by a compiled answer.

---

## 7b. Intent-to-Workflow: letting users describe what they want

AI Admin supports **programmatic creation** of profiles, jobs, and workflows via API. This means your app's AI can take a user's natural language request — like *"I want AI to research a TAM for me"* — decompose it into a multi-step workflow, confirm the plan, and build the infrastructure automatically.

The full reference for this capability lives in **`docs/integration/WORKFLOW_BUILDER_PROMPT.md`** — a compact, self-contained document designed to fit in an LLM context window. Load it into your AI's context when a user asks for a new AI-powered feature.

### Bootstrap prompt for Lovable project knowledge

Copy-paste this block into your Lovable project's **Knowledge** (or system prompt). It tells the Lovable AI when and how to create AI Admin workflows from user requests:

```
## AI Admin — Workflow Builder

When a user asks you to add an AI-powered feature, build an AI workflow, or automate
a multi-step task using AI (e.g. "build me a TAM", "add AI to analyze candidates",
"create an AI content pipeline"):

1. Load the Workflow Builder reference: /integration/WORKFLOW_BUILDER_PROMPT.md
2. Follow the TWO-PHASE flow:
   Phase 1 — PLAN: Decompose the request into logical steps. Present the plan to the
   user in plain language (step names, what each does, data flow, model choice). Wait
   for confirmation before creating anything.
   Phase 2 — BUILD: Generate Edge Function code that calls the AI Admin API to create:
   a) An AI profile (if no suitable one exists) — POST /api/ai-profiles
   b) Processing jobs (one per step) — POST /api/processing-jobs
   c) A workflow with inline steps — POST /api/workflows
   Then wire the execution code (open session → trigger steps → read results).
3. Use the existing Edge Function at /supabase/functions/ai-admin/index.ts for the
   execution patterns (modes: open-chat-session, send-chat-message-stream, get-chat-session).
4. All API calls use the AI Admin API key from Supabase secrets (AI_ADMIN_API_KEY).
5. When designing prompts, if a step's output feeds into a later step, set
   expectedResponseFormat: "json" and include the JSON schema in the prompt text.
```

### Bootstrap rule for Cursor / AI coding assistants

Save this as `.cursor/rules/workflow-builder.mdc` (or equivalent for your tool):

```
---
description: Create AI Admin workflows from user intent
globs:
  - supabase/functions/**
  - src/**/ai/**
  - src/**/workflow*/**
---

# AI Admin Workflow Builder

When the user asks to add an AI-powered feature or build a multi-step AI workflow:

1. Read `docs/integration/WORKFLOW_BUILDER_PROMPT.md` for the full reference.
2. Follow the two-phase flow: plan first (confirm with user), then build.
3. Create resources via the AI Admin API in order:
   - AI profile (if needed): POST /api/ai-profiles
   - Processing jobs (one per step): POST /api/processing-jobs
   - Workflow with inline steps: POST /api/workflows
4. Wire execution using chat sessions:
   - Open: POST /api/chat-sessions with workflowSlug
   - Step: POST /api/chat-sessions/:id/messages with stepKey
   - Read: GET /api/chat-sessions/:id for workflow_variables
5. Use expectedResponseFormat: "json" on any job whose output feeds later steps.
6. Only step 1 needs explicit variables; subsequent steps auto-resolve from the pipeline.
```

---

## 8. MCP Tools & External Integrations (Gmail, Google Drive, Slack, etc.)

AI Admin supports **MCP (Model Context Protocol)** tools via Devs.ai. MCP tools let an AI agent interact with external services (Gmail, Google Drive, Slack, Jira, etc.) on behalf of a user during a conversation.

> **MUST understand:** There are **two layers** of authentication for MCP-enabled agent profiles. Lovable must implement both before a user can successfully use MCP tools:
>
> 1. **Layer 1 — Devs.ai credential (personal API key):** The user's personal Devs.ai API key. Stored once via the `store-user-credential` Edge Function mode. This tells AI Admin to use the user's own Devs.ai account (not the org's shared key) so MCP OAuth tokens are scoped to that individual. **Without this, AI Admin rejects the chat session with a 403.**
> 2. **Layer 2 — Google/service OAuth (per tool):** Each MCP tool (Gmail, Drive, Calendar, Figma, etc.) requires its own OAuth consent via the service provider (e.g. Google). **Devs.ai sends the Google OAuth authorization URL(s) back to your app during the chat stream** as `tool.message` SSE events. Your app MUST capture these URLs and open them for the user to complete authorization.
>
> **CRITICAL — how Google auth actually works at runtime:** When the AI tries to use a Google tool (e.g. Gmail) that the user hasn't authorized, **Devs.ai sends back an OAuth URL inside the SSE stream**. The stream pauses. Your Lovable app MUST:
> 1. Detect the `tool.message` SSE event with `requiresUserAction: true` and an `authUrl` in the parsed `output`.
> 2. Open that `authUrl` for the user (popup or new tab) — this is a Google consent screen.
> 3. After the user authorizes and the popup closes, call `submit-tool-outputs` to tell the AI "authorization is done."
> 4. The AI retries the tool call and the conversation continues.
>
> Your app can **optionally** check and pre-authorize tools before chat starts (via `check-tool-auth` + `initiate-tool-oauth`), but the mid-stream capture is the **required** path because the AI may try any tool at any time during a conversation.

### How it works

1. **Org admin** enables MCP servers (e.g. Google Services) in the Devs.ai dashboard, attaches them to an AI agent, and optionally enables **"Requires personal credentials"** on the AI profile in AI Admin.
2. **Each user** stores their personal Devs.ai API key via the `store-user-credential` mode (see §4). AI Admin encrypts and stores it (AES-256-GCM).
3. **User authorizes** each external service (e.g. Google) via an OAuth flow. Your Lovable app initiates this with `initiate-tool-oauth` (see §4) and can check status with `check-tool-auth`.
4. **During chat**, the AI agent automatically uses MCP tools to search/read/write external data using the user's own OAuth tokens. Tool activity appears as `tool.call` / `tool.result` events in the SSE stream (see §6).

### Per-user API keys

Each user's personal Devs.ai key is stored encrypted (AES-256-GCM) in AI Admin and associated with their forwarded user ID. When AI Admin opens a chat session for a user who has a personal key, it uses **that key** instead of the shared provider key. This means:

- Devs.ai associates MCP OAuth tokens with **that user's account**, not the org account.
- Each user's Gmail, Drive, etc. access is fully isolated.
- Revoking a user's key immediately cuts off their MCP tool access.

### Tool discovery

```
GET /api/ai-profiles/:profileId/tools
```

Returns all tools (built-in + MCP) configured on the Devs.ai agent. MCP tools have `type: "MCP_SERVER"`. Use this to build a dynamic UI showing which integrations are available on a given profile.

### Profiles that require personal credentials

Admins can mark AI profiles with **"Requires personal credentials"** in the AI Admin UI. When this flag is set:

- AI Admin **rejects** `open-chat-session` with a **403** error if the user has no stored Devs.ai key.
- The error message says: *"This profile requires personal credentials. Store a key via POST /api/user-credentials."*
- Your Lovable app **MUST** check for this 403 and show a "Connect your Devs.ai account" prompt before retrying.

### Reference IDs: AI XP Launch Playbook Agent

> **MUST use these exact UUIDs** when integrating with the AI XP Launch Playbook Agent profile.

| Entity | UUID | Used in |
|--------|------|---------|
| **Devs.ai provider** | `e18494d2-beb9-4124-86b6-40a094be621a` | `store-user-credential` → `providerId` |
| **AI XP Launch Playbook Agent** (profile) | `94d8b160-0861-4959-a5d1-d7555448ddcf` | `open-chat-session` → `aiProfileId`, `check-tool-auth` → `profileId`, `initiate-tool-oauth` → `profileId` |
| **Google Drive** (MCP tool) | `cmnho7jt900000bjo3n0il07b` | `check-tool-auth` → `toolId`, `initiate-tool-oauth` → `toolId` |
| **Gmail** (MCP tool) | `cmnqokqd000070bjmyzs3f5pm` | `check-tool-auth` → `toolId`, `initiate-tool-oauth` → `toolId` |
| **Google Calendar** (MCP tool) | `cmntbjye600060bl51u8dcexs` | `check-tool-auth` → `toolId`, `initiate-tool-oauth` → `toolId` |
| **Figma** (MCP tool) | `cmntbk9g0000s0cjov7wrolwe` | `check-tool-auth` → `toolId`, `initiate-tool-oauth` → `toolId` |

> **Note:** `check-tool-auth` and `initiate-tool-oauth` are **Edge Function modes** (not tool IDs). They accept `profileId` + `toolId` as parameters. You call them once per MCP tool that needs OAuth.

---

### Cookbook: Full credential + Google OAuth + chat flow

> **MUST implement this sequence.** This is the complete, ordered flow for connecting a Lovable user to the AI XP Launch Playbook Agent and authorizing Google services.

**Prerequisites:** Edge Function deployed with `AI_ADMIN_BASE_URL` and `AI_ADMIN_API_KEY` secrets. Lovable user is authenticated (has a Supabase JWT).

**All Edge Function calls below use `fetch()` (for SSE modes) or `supabase.functions.invoke()` (for JSON modes). Every call includes the user's Supabase JWT in the `Authorization` header so the Edge Function can extract `X-Forwarded-User-Id`.**

#### Step 1: Store the user's personal Devs.ai API key (one-time, REQUIRED)

The user must provide their **personal Devs.ai API key** (not the org key). Your app should prompt for this on first use and store it via the Edge Function. **Without this step, AI Admin returns 403 on `open-chat-session`.**

```ts
const { data, error } = await supabase.functions.invoke('ai-admin', {
  body: {
    mode: 'store-user-credential',
    providerId: 'e18494d2-beb9-4124-86b6-40a094be621a',   // Devs.ai provider UUID
    apiKey: userEnteredApiKey,                              // the user's personal Devs.ai key
    label: 'Personal Devs.ai key',
  },
});

if (error || data?.error) {
  // Show error — likely invalid key format (must be 8–500 chars, no whitespace)
  console.error('Failed to store credential:', data?.error || error);
  return;
}
// Success — key is encrypted and stored. User never needs to enter it again
// (unless they revoke/rotate it).
```

> **MUST:** Collect the Devs.ai API key from the user via a secure input field. Never hardcode it. The key is encrypted server-side (AES-256-GCM) and never returned in API responses.

> **How to know if the user already has a key stored:** Track this in your Lovable app's own state (e.g. a `hasDevsAiKey` flag in your user profile table). Alternatively, attempt to open a chat session — if the profile requires personal credentials and the user has no key, AI Admin returns a **403** status code. Branch on the HTTP status, not the error message text (error messages are sanitized and may change between versions).

#### Step 2: Open a chat session (REQUIRED)

Once the Devs.ai key is stored, open a chat session. **Google OAuth is NOT required before opening a session** — it happens during the chat when the AI tries to use a Google tool.

```ts
const { data: session, error } = await supabase.functions.invoke('ai-admin', {
  body: {
    mode: 'open-chat-session',
    aiProfileId: '94d8b160-0861-4959-a5d1-d7555448ddcf',
    callingApplication: 'lovable:your-app-name',
  },
});

if (error || session?.error) {
  // Branch on HTTP status, not error message text (messages are sanitized).
  // supabase.functions.invoke sets error.status on non-2xx responses.
  if (error?.status === 403) {
    // → 403 means missing credentials. Go back to Step 1.
  }
  return;
}

const sessionId = session.sessionId;
// session.aiProfile = { name: "AI XP Launch Playbook Agent", ... }
```

> **MUST handle the 403 status.** If `open-chat-session` returns HTTP 403, your app MUST prompt the user to enter their Devs.ai API key (Step 1) before retrying. Always branch on the HTTP status code — never match on error message substrings, as messages are sanitized and may change between versions.

#### Step 3: Send messages and capture Google OAuth URLs from the stream (REQUIRED)

> **CRITICAL — this is the primary way Google auth happens.** When the user sends a message and the AI tries to use a Google tool (Gmail, Drive, Calendar) that the user hasn't authorized, **Devs.ai sends back the Google OAuth URL inside the SSE stream** as a `tool.message` event. The stream pauses until the user completes authorization. Your Lovable app **MUST** detect this event, open the URL, and resume the stream after the user authorizes.

Stream messages via `fetch()` (not `supabase.functions.invoke()`).

```ts
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/ai-admin`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAccessToken}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      mode: 'send-chat-message-stream',
      sessionId,
      message: 'Search my Gmail for invoices from last month',
    }),
  }
);

const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  const lines = buffer.split('\n');
  buffer = lines.pop()!;

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    if (dataStr === '[DONE]') continue;

    let parsed;
    try { parsed = JSON.parse(dataStr); } catch { continue; }

    if (parsed.type === 'tool.call') {
      // AI is calling an MCP tool (e.g. gmail.search)
      // Show a "Searching Gmail..." indicator in the UI
    }

    else if (parsed.type === 'tool.result') {
      // Tool finished executing — dismiss the indicator
    }

    else if (parsed.type === 'tool.message' && parsed.requiresUserAction) {
      // ╔══════════════════════════════════════════════════════════════════╗
      // ║  GOOGLE OAUTH CAPTURE — Devs.ai sent back an auth link.       ║
      // ║  The stream is PAUSED. It will NOT continue until you call     ║
      // ║  submit-tool-outputs after the user completes authorization.   ║
      // ╚══════════════════════════════════════════════════════════════════╝
      //
      // parsed.output is a STRINGIFIED JSON — you must JSON.parse() it.
      // It contains: { authUrl: "https://accounts.google.com/o/oauth2/...", ... }
      //
      let outputData;
      try { outputData = JSON.parse(parsed.output); } catch { continue; }

      if (outputData.authUrl) {
        // outputData.authUrl is a Google OAuth consent URL.
        // MUST open it for the user — popup or new tab:
        const popup = window.open(outputData.authUrl, 'oauth', 'width=600,height=700');

        // After user completes Google consent and closes popup, resume the stream:
        const pollTimer = setInterval(async () => {
          if (!popup || popup.closed) {
            clearInterval(pollTimer);
            // Resume the conversation by submitting tool outputs (Step 4):
            await resumeAfterOAuth(sessionId, parsed.toolCallId);
          }
        }, 1000);
      }
    }

    else if (parsed.content || parsed.delta) {
      // Text content delta — append to the chat message UI
      appendToMessage(parsed.content || parsed.delta);
    }
  }
}
```

> **MUST:** The `output` field on a `tool.message` event is a **stringified JSON string**. You must `JSON.parse(parsed.output)` to extract the `authUrl`. Do not try to read `parsed.authUrl` directly — it does not exist at the top level.

> **What the raw SSE line looks like:**
> ```
> data: {"type":"tool.message","toolCallId":"tc_xyz789","output":"{\"requiresUserAction\":true,\"authUrl\":\"https://accounts.google.com/o/oauth2/v2/auth?client_id=...&scope=...&redirect_uri=...\",\"message\":\"Please authorize Google access\"}","requiresUserAction":true}
> ```
> Your app must: (1) detect `type === "tool.message"` + `requiresUserAction === true`, (2) `JSON.parse(parsed.output)`, (3) check for `authUrl`, (4) open it for the user.

#### Step 4: Resume the stream after Google OAuth (REQUIRED)

After the user completes Google OAuth in the popup, call `submit-tool-outputs` to tell the AI "authorization is done." The response is a **new SSE stream** that continues where the AI left off — the AI retries the tool call (now authorized) and the conversation resumes.

```ts
async function resumeAfterOAuth(sessionId: string, toolCallId: string) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/ai-admin`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseAccessToken}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        mode: 'submit-tool-outputs',
        sessionId,
        systemMessageId: toolCallId,   // the toolCallId from the tool.message event
        outputs: [
          {
            toolCallId,
            output: JSON.stringify({ status: 'authorized' }),
          },
        ],
      }),
    }
  );

  // IMPORTANT: This returns a NEW SSE stream, not JSON.
  // Read it the same way as Step 3 — same fetch() + ReadableStream logic.
  // The AI will retry the tool call (now authorized) and continue the conversation.
  // Wire this through the SAME SSE parser / streamAiAdminSSE helper.
  // The new stream may ALSO contain tool.message events if additional tools need auth.
}
```

> **MUST:** The `submit-tool-outputs` response is an SSE stream, not JSON. Parse it with the same `fetch()` + `ReadableStream` logic as `send-chat-message-stream`. See §6 for the `streamAiAdminSSE` helper that handles both.

> **Multiple Google services:** The AI may trigger OAuth prompts for multiple Google services in sequence (e.g. first Gmail, then Drive). Each one pauses the stream with its own `tool.message` + `authUrl`. After each authorization + `submit-tool-outputs`, the AI continues and may hit the next unauthorized tool. Your SSE parser must handle this loop.

---

#### Optional: Pre-authorize Google tools before chat (NICE TO HAVE)

> **This step is optional.** The mid-stream OAuth capture in Steps 3–4 handles all cases. However, pre-authorizing improves UX by avoiding interruptions during the first conversation.

Check which Google services need OAuth authorization before starting a chat. Call `check-tool-auth` for **each** MCP tool individually.

```ts
const PROFILE_ID = '94d8b160-0861-4959-a5d1-d7555448ddcf';

const googleTools = [
  { toolId: 'cmnqokqd000070bjmyzs3f5pm', name: 'Gmail' },
  { toolId: 'cmnho7jt900000bjo3n0il07b', name: 'Google Drive' },
  { toolId: 'cmntbjye600060bl51u8dcexs', name: 'Google Calendar' },
];

const toolAuthStatus = await Promise.all(
  googleTools.map(async (tool) => {
    const { data } = await supabase.functions.invoke('ai-admin', {
      body: {
        mode: 'check-tool-auth',
        profileId: PROFILE_ID,
        toolId: tool.toolId,
      },
    });
    return { ...tool, hasToken: data?.hasToken ?? false };
  })
);
// Show UI with green "Connected" / red "Not connected" badges per tool.
```

For tools where `hasToken` is `false`, call `initiate-tool-oauth` to get an OAuth URL and open it for the user:

```ts
async function preAuthorizeGoogleTool(toolId: string, toolName: string) {
  const { data, error } = await supabase.functions.invoke('ai-admin', {
    body: {
      mode: 'initiate-tool-oauth',
      profileId: '94d8b160-0861-4959-a5d1-d7555448ddcf',
      toolId,
    },
  });

  if (error || !data?.authUrl) {
    console.error(`Failed to initiate OAuth for ${toolName}:`, error || data);
    return;
  }

  const popup = window.open(data.authUrl, 'google-oauth', 'width=600,height=700');

  const pollTimer = setInterval(async () => {
    if (!popup || popup.closed) {
      clearInterval(pollTimer);
      const { data: status } = await supabase.functions.invoke('ai-admin', {
        body: { mode: 'check-tool-auth', profileId: PROFILE_ID, toolId },
      });
      if (status?.hasToken) {
        // Update UI: green "Connected" badge
      }
    }
  }, 1000);
}
```

> **Note:** Google may grant access to multiple services (Drive, Gmail, Calendar) in a single OAuth consent depending on the scopes. After authorizing one tool, re-check the others — they may now show `hasToken: true` as well.

---

#### Summary: complete sequence diagram

```
User opens app
  │
  ├─ Has Devs.ai key stored? ──── NO ──→ Show "Enter your Devs.ai API key" form
  │     │                                        │
  │     │                              store-user-credential (providerId + apiKey)
  │     │                                        │
  │     YES ◄────────────────────────────────────┘
  │
  ├─ (OPTIONAL) Pre-check Google tool auth status
  │     │
  │     ├─ check-tool-auth for each tool → show connection badges
  │     └─ initiate-tool-oauth for unconnected tools → user authorizes in popup
  │
  ├─ open-chat-session (aiProfileId)
  │     │
  │     ├─ 403 "requires personal credentials" ──→ Go back to "store key" step
  │     │
  │     SUCCESS → sessionId
  │
  ├─ send-chat-message-stream (sessionId + message)
  │     │
  │     ├─ SSE: tool.call → Show "Searching Gmail..." indicator
  │     │
  │     ├─ SSE: tool.message with authUrl ← DEVS.AI SENDS GOOGLE AUTH LINK
  │     │     │
  │     │     ├─ JSON.parse(parsed.output) → extract authUrl
  │     │     ├─ Open authUrl in popup → user completes Google consent
  │     │     ├─ Popup closes → call submit-tool-outputs
  │     │     └─ NEW SSE stream continues (may have more auth prompts)
  │     │
  │     ├─ SSE: tool.result → Dismiss indicator
  │     ├─ SSE: content deltas → Append to chat UI
  │     └─ SSE: [DONE] → Message complete
  │
  └─ Repeat messages as needed
```

---

## 9. File Attachments & AI-Generated Files

AI Admin supports **bidirectional file exchange** with the AI: your Lovable app can send files to the AI for analysis, and receive AI-generated files back.

### How sending files works (signed URL flow)

Your Lovable app does **not** upload files directly to AI Admin. Instead:

1. **Upload** the file to your Lovable project's **Supabase Storage**.
2. **Create a signed URL** (time-limited, e.g. 5 minutes) for that file.
3. **Include** the signed URL in the `attachments` array of your Edge Function request.
4. AI Admin **downloads** the file from the signed URL, **uploads** it to the AI provider, and includes it in the prompt.

This keeps file transit efficient (no large binary payloads through your Edge Function) and secure (signed URLs expire).

### Attachment schema

```json
{
  "attachments": [
    {
      "url": "https://your-project.supabase.co/storage/v1/object/sign/…",
      "mimeType": "text/csv",
      "fileName": "quarterly-report.csv"
    }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | HTTPS signed URL pointing to the file. Must be from a trusted domain (see limits below). |
| `mimeType` | string | Yes | MIME type of the file. Determines how AI Admin classifies the file for the AI provider. |
| `fileName` | string | Yes | Display name for the file. |

### Supported file types

| Category | MIME types | Behavior |
|----------|-----------|----------|
| **Documents** | `text/csv`, `text/plain`, `application/json`, `application/pdf`, `application/xml` | For chat: uploaded to AI and referenced by ID. For jobs/completions: text content extracted and injected into prompt. |
| **Images** | `image/png`, `image/jpeg`, `image/gif`, `image/webp` | Uploaded to AI and referenced as image content. |
| **Audio** | `audio/*` | Uploaded to AI provider. |
| **Video** | `video/*` | Uploaded to AI provider. |

### Limits

| Limit | Default | Configurable? |
|-------|---------|---------------|
| Max file size | **5 MB** per file | Yes — `max_attachment_size_bytes` in AI Admin → Settings |
| Allowed domains | All HTTPS (empty = allow all) | Yes — `allowed_attachment_domains` in AI Admin → Settings (JSON array of hostnames) |

If your org restricts domains, add your Supabase Storage hostname (e.g. `your-project.supabase.co`) to the allow-list in AI Admin settings.

### Which modes accept attachments?

| Mode | Behavior with attachments |
|------|---------------------------|
| `send-chat-message-stream` | Files are uploaded to the AI provider's chat session and referenced alongside the message text. The AI can read/analyze the file content. |
| `ask-ai-profile` | Text-based files are downloaded and prepended to the prompt. Binary files are skipped. |
| `run-processing-job` | Text-based files are downloaded and prepended before the prompt template. Binary files are skipped with a warning. |

### Receiving AI-generated files

The AI may generate files during a conversation (e.g. CSV exports, code files). These are delivered in **two ways**:

**1. Real-time via SSE stream** — a `files` event is emitted:

```
data: {"type":"files","files":[{"id":"abc123","filename":"report.csv","url":"https://…","mimeType":"text/csv","size":"2048 bytes"}]}
```

**2. After the fact via `list-chat-files`** — call this mode to get all files for a session:

```json
{ "mode": "list-chat-files", "sessionId": "your-session-id" }
```

File URLs are **publicly accessible** (Vercel Blob Storage) — no additional authentication is needed to download them.

### Code example: upload to Supabase Storage and build attachments

```ts
// React hook for file upload with signed URL generation
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Attachment {
  url: string;
  mimeType: string;
  fileName: string;
}

export function useFileUpload(bucket = 'chat-attachments') {
  const [uploading, setUploading] = useState(false);

  async function uploadFile(file: File): Promise<Attachment> {
    setUploading(true);
    try {
      const path = `${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(path, file);
      if (uploadError) throw uploadError;

      const { data: signedData, error: signError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 300); // 5 minutes
      if (signError || !signedData?.signedUrl) throw signError;

      return {
        url: signedData.signedUrl,
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name,
      };
    } finally {
      setUploading(false);
    }
  }

  return { uploadFile, uploading };
}
```

### Code example: send a chat message with attachments

```ts
const { uploadFile } = useFileUpload();

async function sendMessageWithFile(sessionId: string, message: string, file: File) {
  const attachment = await uploadFile(file);

  const response = await fetch(edgeFunctionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${anonKey}`,
      'apikey': anonKey,
    },
    body: JSON.stringify({
      mode: 'send-chat-message-stream',
      sessionId,
      message,
      attachments: [attachment],
    }),
  });

  // Read SSE stream...
}
```

### Code example: handle file events in SSE stream

```ts
function parseSSELine(line: string) {
  if (!line.startsWith('data: ')) return null;
  const dataStr = line.slice(6).trim();
  if (dataStr === '[DONE]') return { type: 'done' };
  try {
    return JSON.parse(dataStr);
  } catch {
    return null;
  }
}

// Inside your SSE reader loop:
const parsed = parseSSELine(line);
if (parsed?.type === 'files') {
  for (const file of parsed.files) {
    // file.id, file.filename, file.url, file.mimeType, file.size
    addFileToChat({
      name: file.filename,
      downloadUrl: file.url,
      type: file.mimeType,
    });
  }
}
```

### Code example: list all files after a conversation

```ts
const { data } = await supabase.functions.invoke('ai-admin', {
  body: { mode: 'list-chat-files', sessionId },
});
// data.files = [{ id, source, filename, size, mimeType, url, status }]
```

---

## 10. Workflows — Structured Steps in a Chat Session

> **Summary:** Multi-step chat pipelines with variable mappings, dependencies, and step-by-step orchestration from the calling app.

Workflows let you interleave structured, template-driven prompts with free-form conversation within a single streaming chat session. Each workflow groups a set of processing jobs as "steps" that the application can trigger at any point in the conversation.

### When to use workflows

| Scenario | What to use | Why |
|----------|-------------|-----|
| One-shot structured prompt → JSON result | `run-processing-job` | No conversation context needed. Fire and forget. |
| Free-form chat conversation | `open-chat-session` + `send-chat-message-stream` | No structured prompts — just open-ended conversation. |
| Mix of structured prompts AND free-form chat in one session | **Workflows** | Steps enforce structure; free-form messages fill the gaps. |
| Multi-step AI pipeline where each step builds on the last | **Workflows** with variable pipeline | Output from step 1 feeds into step 2 automatically. |
| Same structured task invoked in different contexts | **Rule Sets** (§11) | Multiple named prompts on one job, no ordering enforced. |

### Real-world use cases

**Content creation pipeline:** A "Product Launch Planner" workflow with steps: `research-competitors` → `generate-positioning` → `write-copy`. Each step produces structured output that feeds into the next. Between steps, the user can ask follow-up questions or request changes in free-form chat.

**Customer support analysis:** A "Ticket Analyzer" workflow with steps: `classify-intent` → `extract-entities` → `suggest-resolution`. The classification result flows into entity extraction, and both feed into resolution suggestions. The agent can also chat naturally about the ticket.

**Document processing:** A "Contract Review" workflow with steps: `extract-clauses` → `identify-risks` → `generate-summary`. Each step's structured JSON output is automatically available to subsequent steps.

**Interview preparation:** A "Interview Coach" workflow with steps: `analyze-job-posting` → `generate-questions` → `create-study-plan`. The user provides the job posting, the AI analyzes it, generates tailored questions, and builds a study plan — all in one conversational flow.

### Setting up a workflow (step by step)

**Step 1: Create the processing jobs** that will serve as workflow steps. Each job has its own prompt template, variables, expected output schema, and formatting rules. These jobs can also be used independently outside the workflow.

**Step 2: Create the workflow** in AI Admin (UI or API). Assign an AI profile and add your processing jobs as steps. For each step, configure:
- **Step key** — a unique identifier the calling app uses to trigger the step (e.g. `analyze-data`, `generate-report`).
- **Sort order** — determines the default execution order.
- **Dependencies** — which other step keys must complete first (optional, enforced by the server).
- **Input mappings** — map workflow variables (from earlier steps or workflow inputs) to this job's template placeholders.
- **Output mappings** — name the workflow variables where each JSON output field will be stored for later steps.

**Step 3: Define workflow input variables** — these are the initial variables the calling application provides when invoking the workflow. They are available to all steps from the start.

**Step 4: Test in AI Admin** — use the built-in test simulator to dry-run or live-run the workflow. The "Executions" tab shows full per-step logs, variable transitions, and diagnostics.

### How it works

1. **Create a workflow** in AI Admin (UI or API) that references an AI profile and one or more processing jobs as steps.
2. **Open a chat session** with `workflowSlug` or `workflowId` — the response includes the available `steps` array.
3. **Send messages** — either free-form (`message`) or step-triggered (`stepKey` + `variables`). Both go through the same streaming endpoint and keep the conversation context.
4. When a step is triggered, AI Admin loads the processing job's prompt template, interpolates variables, and sends the constructed prompt in the chat session. Formatting rules from the job are applied to the response.
5. **Variable pipeline:** If steps have `inputMappings` configured, AI Admin automatically injects accumulated variables from earlier steps into the job's template placeholders. After the LLM responds, `outputMappings` extract top-level JSON fields from the response and store them for use by subsequent steps. You only need to provide the initial workflow input variables — the pipeline handles cross-step data flow automatically.
6. **Auto-captured variables:** After every workflow step, AI Admin automatically captures the full resolved prompt and assistant response as `{stepKey}.prompt` and `{stepKey}.response` in the session's `workflow_variables`. These are available to subsequent steps via input mappings without needing explicit output mappings. This means you can always reference what an earlier step said — even without configuring explicit output mappings.
7. **Diagnostics by default:** Diagnostic logging is enabled by default for all jobs. Each step execution produces a diagnostic log entry with request payloads, LLM timing, token usage, and error details. Query per-session logs via `GET /api/diagnostic-logs?chatSessionId=<id>`.

### Variable pipeline in detail

The variable pipeline is the mechanism that passes data between workflow steps. It works in three layers:

**Layer 1: Workflow input variables** — defined on the workflow itself. The calling application provides these when starting the session. They are available to all steps from the beginning.

**Layer 2: Output mappings → input mappings** — after a step's LLM response, AI Admin parses the response as JSON and extracts fields according to the step's `outputMappings`. These are stored in the session's `workflow_variables` accumulator. Subsequent steps can reference them via `inputMappings`.

**Layer 3: Auto-captured prompt/response** — regardless of output mappings, every step automatically writes `{stepKey}.prompt` (the resolved prompt sent to the LLM) and `{stepKey}.response` (the full assistant response) into `workflow_variables`. This lets later steps reference the exact text of earlier interactions.

**Example:** A two-step workflow where step 1 analyzes data and step 2 generates a report:

```
Workflow input variables: [companyName, industry]

Step 1: "analyze" (job: Company Analyzer)
  Input mappings:  company → companyName, sector → industry
  Output mappings: strengths → analysis_strengths, risks → analysis_risks
  Auto-captured:   analyze.prompt, analyze.response

Step 2: "report" (job: Report Generator)
  Input mappings:  strengths → analysis_strengths, risks → analysis_risks,
                   raw_analysis → analyze.response
  Output mappings: report → final_report
  Auto-captured:   report.prompt, report.response
```

After both steps complete, the session's `workflow_variables` contains: `analysis_strengths`, `analysis_risks`, `analyze.prompt`, `analyze.response`, `final_report`, `report.prompt`, `report.response`.

### Observing workflow executions

AI Admin provides full observability for workflow executions:

- **Execution log viewer:** In the AI Admin UI, open any workflow and click the "Executions" tab. This shows all chat sessions that used the workflow, and for each session you can see every step's prompt, response, variable transitions (before/after diff), and full diagnostic details.
- **Per-step diagnostics:** Each step produces a diagnostic log entry with LLM timing, token usage, provider/model info, and error details. These are matched to steps via the `stepKey` in the `request_payload`.
- **Variable transition view:** The execution log shows exactly which variables were added or modified after each step, making it easy to debug data flow issues.
- **API access:** Query diagnostic logs for a specific session: `GET /api/diagnostic-logs?chatSessionId=<session-id>`. Each entry's `request_payload.stepKey` identifies which workflow step produced it.

### Opening a workflow session

```ts
const { data: session } = await supabase.functions.invoke('ai-admin', {
  body: {
    mode: 'open-chat-session',
    workflowSlug: 'product-launch-planner',
    callingApplication: 'lovable:my-app',
  },
});

// session.sessionId — use for all subsequent messages
// session.steps — available steps:
// [
//   { stepKey: "generate-timeline", name: "Generate Timeline", sortOrder: 0, isRequired: true, dependsOn: [] },
//   { stepKey: "estimate-budget", name: "Estimate Budget", sortOrder: 1, isRequired: false, dependsOn: ["generate-timeline"] },
// ]
```

### Sending a free-form message (unchanged)

```ts
const response = await fetch(edgeFnUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({
    mode: 'send-chat-message-stream',
    sessionId: session.sessionId,
    message: 'I want to plan a product launch for our new AI tool.',
  }),
});
// Process SSE stream as usual
```

### Triggering a workflow step

```ts
const response = await fetch(edgeFnUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({
    mode: 'send-chat-message-stream',
    sessionId: session.sessionId,
    stepKey: 'generate-timeline',
    variables: { productName: 'AI Assistant', launchDate: '2026-06-01' },
  }),
});
// The AI sees the interpolated prompt template, not the raw variables.
// Response streams back as SSE — the structured result is in the AI's response.
```

### Step dependencies

Steps can declare `dependsOn: ["other-step-key"]`. If you trigger a step before its dependencies are completed (i.e., the dependent step has not been triggered earlier in this session), the API returns a `400` error explaining which steps must be completed first.

Dependencies are enforced but not mandatory — if a step has no `dependsOn`, it can be triggered at any time.

### Typical workflow pattern

```
1. open-chat-session (workflowSlug)
2. send-chat-message-stream (message: "Let's plan a product launch")  ← free-form
3. AI responds with conversation
4. send-chat-message-stream (stepKey: "generate-timeline", variables: {...})  ← structured
5. AI responds with timeline JSON
6. send-chat-message-stream (message: "Can we move beta earlier?")  ← free-form
7. AI discusses the change with context from the whole conversation
8. send-chat-message-stream (stepKey: "estimate-budget", variables: {...})  ← structured
9. AI responds with budget breakdown
```

The AI has full context of the conversation (free-form and structured messages together), so structured responses can build on earlier discussion.

### End-to-end workflow example: TAM Research

This section walks through the complete lifecycle of a programmatic multi-step workflow — from creating the jobs through the Edge Function to reading the final results. The example builds a TAM (Total Addressable Market) research pipeline with three steps: find sources, evaluate credibility, and calculate the TAM.

#### Step 1: Create the processing jobs via Edge Function

Each workflow step is backed by a processing job with a prompt template. Placeholders use `{{variableName}}` syntax. **If a step needs structured output for the variable pipeline, the prompt must instruct the LLM to respond in JSON and set `expectedResponseFormat: "json"`.**

```typescript
// Create each job from your Lovable Edge Function or setup script
const createJob = async (job: Record<string, unknown>) => {
  const res = await fetch(`${AI_ADMIN_BASE}/api/processing-jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_ADMIN_API_KEY}`,
    },
    body: JSON.stringify(job),
  });
  return res.json();
};

// Job 1: Find sources
const findSourcesJob = await createJob({
  name: "Find TAM Sources",
  slug: "find-tam-sources",
  ai_profile_id: "<your-profile-uuid>",
  config: {
    promptTemplate:
      "Research the Total Addressable Market for {{market}}.\n\n" +
      "Find 5-8 credible sources (industry reports, analyst estimates, government data).\n\n" +
      "Respond in JSON:\n" +
      '{ "sources": [{ "name": "...", "url": "...", "type": "report|analyst|government", "relevance": "..." }], ' +
      '"market_definition": "..." }',
    expectedResponseFormat: "json",
  },
});

// Job 2: Evaluate sources
const evaluateJob = await createJob({
  name: "Evaluate Source Credibility",
  slug: "evaluate-sources",
  ai_profile_id: "<your-profile-uuid>",
  config: {
    promptTemplate:
      "Evaluate the credibility of these sources for TAM analysis of {{market}}:\n\n" +
      "{{sources}}\n\n" +
      "For each source, assess recency, methodology quality, and reliability.\n\n" +
      "Respond in JSON:\n" +
      '{ "evaluations": [{ "name": "...", "score": 1-10, "reasoning": "...", "include": true }], ' +
      '"trusted_sources": ["name1", "name2"] }',
    expectedResponseFormat: "json",
  },
});

// Job 3: Calculate TAM
const calculateJob = await createJob({
  name: "Calculate TAM",
  slug: "calculate-tam",
  ai_profile_id: "<your-profile-uuid>",
  config: {
    promptTemplate:
      "Using the following trusted sources and analysis, calculate the TAM for {{market}}.\n\n" +
      "Trusted sources: {{trusted_sources}}\n" +
      "Source evaluation: {{evaluation_context}}\n" +
      "Original research: {{research_context}}\n\n" +
      "Provide TAM estimate with range, methodology, key assumptions, and confidence level.\n\n" +
      "Respond in JSON:\n" +
      '{ "tam_low": "$X.XB", "tam_mid": "$X.XB", "tam_high": "$X.XB", ' +
      '"methodology": "...", "assumptions": ["..."], "confidence": "low|medium|high", "summary": "..." }',
    expectedResponseFormat: "json",
  },
});
```

#### Step 2: Create the workflow with variable mappings

```typescript
const workflowRes = await fetch(`${AI_ADMIN_BASE}/api/workflows`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${AI_ADMIN_API_KEY}`,
  },
  body: JSON.stringify({
    name: "TAM Research Pipeline",
    slug: "tam-research",
    ai_profile_id: "<your-profile-uuid>",
    config: {
      inputVariables: [
        {
          name: "market",
          label: "Target Market",
          description: "The market or industry to research",
          required: true,
        },
      ],
    },
    steps: [
      {
        processing_job_id: findSourcesJob.id,
        step_key: "find-sources",
        name: "Find TAM Sources",
        sort_order: 1,
        is_required: true,
        config: {
          inputMappings: { market: "market" },
          outputMappings: {
            sources: "raw_sources",
            market_definition: "market_definition",
          },
        },
      },
      {
        processing_job_id: evaluateJob.id,
        step_key: "evaluate",
        name: "Evaluate Source Credibility",
        sort_order: 2,
        is_required: true,
        depends_on: ["find-sources"],
        config: {
          inputMappings: {
            market: "market",
            sources: "raw_sources",
          },
          outputMappings: {
            trusted_sources: "trusted_sources",
          },
        },
      },
      {
        processing_job_id: calculateJob.id,
        step_key: "calculate",
        name: "Calculate TAM",
        sort_order: 3,
        is_required: true,
        depends_on: ["evaluate"],
        config: {
          inputMappings: {
            market: "market",
            trusted_sources: "trusted_sources",
            evaluation_context: "evaluate.response",
            research_context: "find-sources.response",
          },
          outputMappings: {
            tam_low: "tam_low",
            tam_mid: "tam_mid",
            tam_high: "tam_high",
            summary: "tam_summary",
          },
        },
      },
    ],
  }),
});
const workflow = await workflowRes.json();
```

**How `inputMappings` work:** Keys are placeholder names in the prompt template (`{{market}}`, `{{sources}}`). Values are workflow variable names — from initial `inputVariables`, from earlier steps' `outputMappings`, or from auto-captured `{stepKey}.prompt` / `{stepKey}.response` variables.

**How `outputMappings` work:** After the LLM responds, AI Admin parses the response as JSON and extracts top-level fields. Keys are JSON response field names. Values are the workflow variable names where the extracted data is stored for use by subsequent steps.

#### Step 3: Execute the workflow from your Lovable app

**The calling application drives step execution.** There is no auto-sequencing — your code triggers each step, waits for the stream to complete, then triggers the next. This gives you full control over progress UI, intermediate validation, and user input between steps.

```typescript
import { createSSEParser, type SSEEvent } from "./sse-parser"; // see §6

// Helper: consume an SSE stream and return the full assistant response
async function consumeStepStream(
  sessionId: string,
  stepKey: string,
  variables?: Record<string, string>,
  onChunk?: (text: string) => void,
): Promise<string> {
  const { data } = await supabase.functions.invoke("ai-admin", {
    body: {
      mode: "send-chat-message-stream",
      sessionId,
      stepKey,
      ...(variables ? { variables } : {}),
    },
  });

  // data is a ReadableStream when using the Edge Function
  const reader = data.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser();
  let fullResponse = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    const events = parser.feed(chunk);
    for (const event of events) {
      if (event.type === "content" && event.text) {
        fullResponse += event.text;
        onChunk?.(event.text);
      }
    }
  }
  return fullResponse;
}

// ─── Run the full workflow ────────────────────────────────────

// 1. Open a session
const { data: session } = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "open-chat-session",
    workflowSlug: "tam-research",
    callingApplication: "my-lovable-app",
  },
});
const sessionId = session.id;

// 2. Step 1: Find sources — pass the initial variable
setStatus("Finding TAM sources...");
await consumeStepStream(sessionId, "find-sources", { market: userInput }, (text) => {
  appendToUI(text); // stream text to the UI in real time
});

// 3. Step 2: Evaluate sources — no variables needed, pipeline resolves them
setStatus("Evaluating source credibility...");
await consumeStepStream(sessionId, "evaluate", undefined, (text) => {
  appendToUI(text);
});

// 4. Step 3: Calculate TAM — again, pipeline handles all inputs
setStatus("Calculating TAM...");
await consumeStepStream(sessionId, "calculate", undefined, (text) => {
  appendToUI(text);
});

// 5. Read final results
const { data: fullSession } = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "get-chat-session",
    sessionId,
  },
});
const vars = fullSession.workflow_variables;
// vars.tam_mid, vars.tam_low, vars.tam_high, vars.tam_summary, etc.
```

#### What the final `workflow_variables` contain

After all three steps complete, `GET /api/chat-sessions/:id` returns:

```json
{
  "workflow_variables": {
    "market": "AI-powered developer tools",
    "raw_sources": [{ "name": "Gartner", "url": "..." }, "..."],
    "market_definition": "...",
    "find-sources.prompt": "(full resolved prompt text)",
    "find-sources.response": "(full JSON response text)",
    "trusted_sources": ["Gartner", "IDC"],
    "evaluate.prompt": "...",
    "evaluate.response": "...",
    "tam_low": "$15.2B",
    "tam_mid": "$23.7B",
    "tam_high": "$31.4B",
    "tam_summary": "The TAM for AI-powered developer tools is estimated at...",
    "calculate.prompt": "...",
    "calculate.response": "..."
  }
}
```

#### Key takeaways

1. **Prompt templates must produce parseable output** when using `outputMappings`. Instruct the LLM to respond in JSON and set `expectedResponseFormat: "json"` on the job config.
2. **The calling app orchestrates step execution.** Wait for each stream to finish (`data: [DONE]`) before triggering the next step. Server-side dependency checks return 400 if you trigger out of order.
3. **You only pass `variables` for values the pipeline can't resolve.** Step 1 gets `market` from user input. Steps 2 and 3 need nothing — `inputMappings` pull from the accumulated workflow variables.
4. **Auto-captured `{stepKey}.response` is always available.** Even without `outputMappings`, reference any completed step's full response via `inputMappings`.
5. **Read `workflow_variables` from the session** to access all accumulated values after completion — use them for summary cards, reports, or further processing.
6. **Dependency enforcement is server-side.** Triggering a step whose `depends_on` steps haven't completed returns 400.

### API: Workflow management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workflows` | List all workflows |
| POST | `/api/workflows` | Create a workflow (include `steps` array to create steps atomically) |
| GET | `/api/workflows/:id` | Get workflow with steps and AI profile |
| PUT | `/api/workflows/:id` | Update workflow (include `steps` array to replace all steps) |
| DELETE | `/api/workflows/:id` | Delete workflow |
| GET | `/api/workflows/:id/steps` | List steps for a workflow |
| POST | `/api/workflows/:id/steps` | Add a single step |
| PUT | `/api/workflows/:wid/steps/:sid` | Update a single step |
| DELETE | `/api/workflows/:wid/steps/:sid` | Remove a step |

---

## 11. Rule Sets — Multiple Invokable Prompts in a Chat Job

Rule Sets allow a single **chat-mode processing job** to host multiple named prompt templates. Unlike workflows (which are ordered, cross-job sequences), rule sets are parallel: the calling application decides which rule set to invoke and when, with no enforced ordering or dependencies.

### Conceptual hierarchy

```
Provider → AI Profile → Processing Job → Rule Sets → (variables, template, formatting)
```

A chat-mode job defines its rule sets in `config.ruleSets`. Each rule set has a unique `key`, its own prompt template, variable definitions, formatting rules, and optional test data.

> **Rule sets are not standalone entities.** Unlike processing jobs, AI profiles, or workflows, rule sets do **not** have their own database table, UUID, or dedicated API routes. They are JSON objects stored inside a processing job's `config.ruleSets` array. The only identifier is the **`key` string** (e.g. `"analyze-company"`). To look up, invoke, or update a rule set, you always work through the parent processing job. There is no `GET /api/rule-sets/:id` endpoint — it doesn't exist.

### When to use rule sets vs workflows

| Scenario | Use |
|----------|-----|
| A single chat session needs several different structured prompts (no ordering) | **Rule Sets** |
| Prompts must run in a specific order with dependencies | **Workflows** (§10) |
| One-shot structured prompt without a chat session | `run-processing-job` |

### Setting up rule sets in AI Admin

1. Create or open a processing job whose AI profile is in **chat** mode.
2. Select the job and click the new **Rule Sets** tab.
3. Add one or more rule sets. Each has:
   - **Key** — the identifier the app will pass as `ruleSetKey` (e.g. `analyze-company`).
   - **Name / Description** — human-readable labels for the AI Admin UI.
   - **Variables** — same as processing-job variables: `name`, `label`, `source` (`user` | `pipeline`).
   - **Prompt Template** — full prompt with `{{variableName}}` placeholders.
   - **Formatting Rules** — applied to the AI response stream (same rules as Build Rules).
   - **Default Test Data** — pre-filled values for the Test Rule Set tab.
4. Click **Save All Rule Sets**.

### Opening a session for a job with rule sets

Open the session with `jobSlug` or `jobId`. The response includes `ruleSets`:

```ts
const { data: session } = await supabase.functions.invoke('ai-admin', {
  body: {
    mode: 'open-chat-session',
    jobSlug: 'xp-launch-playbook-agent',   // or jobId: 'uuid'
    callingApplication: 'lovable:my-app',
    userId: currentUser.id,
  },
});

// session.sessionId  — save for all messages
// session.ruleSets   — available rule sets:
// [
//   { key: "analyze-company", name: "Analyze Company", description: "..." },
//   { key: "generate-pitch",  name: "Generate Pitch",  description: null  },
// ]
```

### Invoking a rule set

Use `ruleSetKey` + `variables` instead of `message`:

```ts
const response = await fetch(edgeFnUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({
    mode: 'send-chat-message-stream',
    sessionId: session.sessionId,
    ruleSetKey: 'analyze-company',
    variables: {
      companyName: 'HubSpot',
      domain: 'hubspot.com',
      websiteHomepage: '<scraped content>',
    },
  }),
});
// SSE stream — read exactly like a free-form message response.
// The AI response will be formatted according to the rule set's formatting rules.
```

AI Admin will:
1. Look up the rule set by key inside `job.config.ruleSets`.
2. Interpolate the prompt template with the supplied `variables`.
3. Send the composed prompt in the existing chat session (maintaining full conversation history).
4. Apply the rule set's formatting rules to the streaming response.
5. Record `rule_set_key` on the message row for diagnostics.

### CRITICAL: Rule set invocations MUST be sequential (server-enforced)

Each rule set invocation sends a message to the same underlying AI chat session. **You MUST wait for the previous SSE stream to complete (receive `data: [DONE]`) before sending the next `ruleSetKey` invocation.** AI Admin enforces this server-side — sending a second message while the first is still streaming returns **`409 Conflict`**.

This applies to ALL chat message calls on the same session — rule set invocations, free-form messages, workflow step triggers, and tool output submissions. Only one message at a time.

```ts
// CORRECT: wait for the stream to finish before sending the next call
const discoveryStream = await sendRuleSet('discover_sources', { ... });
await consumeEntireStream(discoveryStream); // read until [DONE]

// Now safe to send the next rule set
const draftStream = await sendRuleSet('draft_playbook', { ... });
await consumeEntireStream(draftStream);
```

```ts
// WRONG: sending draft while discovery is still streaming
const discoveryStream = await sendRuleSet('discover_sources', { ... });
// User clicks "Generate" immediately without waiting for [DONE]
const draftStream = await sendRuleSet('draft_playbook', { ... }); // Returns 409 Conflict
```

**Why this matters:** The AI agent builds context as it responds. If rule set A tells the agent to search documents via MCP tools, the agent accumulates that knowledge during its response. Rule set B depends on that context being complete. Sending B before A finishes means the agent receives B mid-thought, and its response will be a confused mix of both tasks.

### Avoiding and handling 409 Conflict

The server rejects concurrent messages on the same session with `409 Conflict` and the body `{ "error": "Session is currently processing another message..." }`. This applies to `send-chat-message-stream` and `submit-tool-outputs`.

**Best practices to avoid 409:**

1. **Disable the send button while streaming.** Track a `isStreaming` boolean; set it `true` when the SSE request starts, `false` when you receive `data: [DONE]` or an error/timeout. Disable the send input until `isStreaming` is `false`.

2. **Use a client-side send queue for programmatic flows.** When automating sequential rule set calls or workflow steps, process them one at a time:

```ts
async function runSequentialRuleSets(
  sessionId: string,
  ruleSets: Array<{ key: string; variables: Record<string, string> }>,
) {
  for (const rs of ruleSets) {
    const stream = await sendRuleSet(sessionId, rs.key, rs.variables);
    await consumeEntireStream(stream); // blocks until [DONE]
  }
}
```

3. **Never fire-and-forget message sends.** Always `await` the full stream consumption before proceeding.

**Handling 409 if it occurs:**

```ts
const res = await fetch(edgeFnUrl, {
  method: 'POST',
  headers: { /* ... */ },
  body: JSON.stringify({ mode: 'send-chat-message-stream', sessionId, message }),
});

if (res.status === 409) {
  // Show the user a brief "Please wait — a response is still in progress" message.
  // Do NOT retry in a tight loop. Wait at least 1–2 seconds before retrying.
  return;
}
// ... proceed with SSE stream parsing ...
```

The session lock auto-expires after approximately 5.5 minutes (the 5-minute SSE timeout plus a safety buffer), so sessions cannot be permanently locked by a crashed client or server.

### Updating rule sets via API

Rule sets live inside the parent job's `config.ruleSets` array. There is no dedicated rule-set update endpoint — you update the **job** with `PUT /api/processing-jobs/:id` and include the full `ruleSets` array in `config`.

**Critical behavior:** `config` is deep-merged, but `ruleSets` is an **array** — arrays are **replaced entirely**, not merged element-by-element. You must send the complete list of rule sets you want stored, not just the one you changed.

**Pattern: read-modify-write**

```ts
// 1. Fetch the current job to get existing rule sets
const jobRes = await fetch(`${base}/api/processing-jobs/${jobId}`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const job = await jobRes.json();
const ruleSets = job.config?.ruleSets ?? [];

// 2. Find and modify the target rule set
const idx = ruleSets.findIndex((rs: any) => rs.key === 'discover-sources');
if (idx !== -1) {
  ruleSets[idx].promptTemplate = `Analyze {{companyName}} at {{domain}}.
Return JSON: { "sources": [{ "name": "...", "url": "...", "type": "..." }] }`;
}

// 3. PUT the entire ruleSets array back (replaces the old array)
await fetch(`${base}/api/processing-jobs/${jobId}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    config: { ruleSets },
  }),
});
```

If you only send `config: { ruleSets: [updatedOne] }`, every other rule set on the job **disappears**. Always read first, modify in place, write back.

### Free-form messages alongside rule sets

You can mix rule set invocations with regular `message` calls in the same session. The AI has full conversation context across both types:

```
1. open-chat-session (jobSlug: 'xp-launch-playbook-agent')
2. send-chat-message-stream (message: "I want to evaluate a company")           ← free-form
3. AI responds conversationally
4. send-chat-message-stream (ruleSetKey: "analyze-company", variables: {...})   ← structured
5. AI returns structured JSON analysis
6. send-chat-message-stream (message: "What's their biggest weakness?")         ← free-form follow-up
7. AI responds with context from the analysis
8. send-chat-message-stream (ruleSetKey: "generate-pitch", variables: {...})    ← another rule set
9. AI returns structured pitch document
```

### Structured response parsing

Rule set responses typically return JSON, but the LLM may wrap it in prose, markdown fences, or reasoning tags. You need a robust extraction strategy.

#### Buffer mode for JSON responses (MUST for rule sets that return JSON)

When a rule set returns structured JSON, the SSE stream delivers it token-by-token (`{"com`, `pany`, `Na`, `me":"`...). Displaying raw JSON fragments to users is **bad UX**. Use this pattern:

1. **During streaming:** Show a loading indicator (e.g. "Analyzing company..."), **not** the raw token stream.
2. **After `[DONE]`:** Parse the accumulated text into structured data and render it in your UI (cards, tables, lists).

```ts
const [isAnalyzing, setIsAnalyzing] = useState(false);
const [result, setResult] = useState<AnalysisResult | null>(null);

async function runRuleSet(ruleSetKey: string, variables: Record<string, string>) {
  setIsAnalyzing(true);
  setResult(null);

  const response = await fetch(edgeFnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      mode: 'send-chat-message-stream',
      sessionId,
      ruleSetKey,
      variables,
      callingApplication: 'lovable:my-app',
    }),
  });

  const fullText = await streamAiAdminSSE(response, {
    onContentDelta: () => {},     // intentionally ignore deltas — don't display raw JSON tokens
    onDone: () => setIsAnalyzing(false),
  });

  const parsed = extractJSON(fullText);
  if (parsed) setResult(parsed);
}
```

For rule sets that return **prose** (not JSON), stream normally — show deltas as they arrive. The buffer pattern is only for structured JSON responses. You can check `expectedFormat` on the rule set metadata to decide which mode to use, but in practice your app knows which rule sets return JSON based on your own design.

#### Robust JSON extraction

LLMs commonly return JSON in these formats:

1. **Clean JSON** — just the object, no wrapping
2. **Markdown-fenced** — `` ```json\n{...}\n``` ``
3. **Prose-wrapped** — "Here's the analysis:\n{...}"
4. **Reasoning-tagged** — `<think>...</think>\n{...}`

Use this extraction function to handle all cases:

```ts
function extractJSON<T = unknown>(text: string): T | null {
  const trimmed = text.trim();

  // 1. Try parsing the entire text as JSON
  try { return JSON.parse(trimmed); } catch {}

  // 2. Try extracting from markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // 3. Try extracting the outermost { ... } or [ ... ]
  const braceStart = trimmed.indexOf('{');
  const bracketStart = trimmed.indexOf('[');
  const start = braceStart === -1 ? bracketStart
    : bracketStart === -1 ? braceStart
    : Math.min(braceStart, bracketStart);
  if (start !== -1) {
    const opener = trimmed[start];
    const closer = opener === '{' ? '}' : ']';
    const lastClose = trimmed.lastIndexOf(closer);
    if (lastClose > start) {
      try { return JSON.parse(trimmed.slice(start, lastClose + 1)); } catch {}
    }
  }

  return null;
}
```

#### Example: rule set prompt template and expected JSON

Here's what a real rule set prompt template looks like when it instructs the LLM to return structured JSON. This is the `promptTemplate` field stored in `config.ruleSets[].promptTemplate`:

```
Analyze the company {{companyName}} (website: {{domain}}).

Research the company and return your analysis as a JSON object with this exact structure:

{
  "companyName": "string — official company name",
  "industry": "string — primary industry",
  "description": "string — 2-3 sentence overview",
  "strengths": ["string array — key competitive strengths"],
  "weaknesses": ["string array — potential risks or gaps"],
  "sources": [
    {
      "name": "string — source name (e.g. 'Company Website')",
      "url": "string — full URL",
      "type": "string — 'website' | 'news' | 'social' | 'financial'"
    }
  ]
}

Return ONLY the JSON object. Do not include any text before or after the JSON.
```

**What the LLM actually returns** (the `fullText` you accumulate from SSE deltas):

```json
{
  "companyName": "HubSpot",
  "industry": "Marketing & Sales Software",
  "description": "HubSpot is a leading CRM platform that provides software for inbound marketing, sales, and customer service. Founded in 2006, they serve over 200,000 customers globally.",
  "strengths": [
    "Strong brand recognition in inbound marketing",
    "Comprehensive freemium model driving adoption",
    "Extensive integration ecosystem"
  ],
  "weaknesses": [
    "Enterprise segment still trails Salesforce",
    "Pricing complexity for scaling businesses"
  ],
  "sources": [
    { "name": "HubSpot Website", "url": "https://www.hubspot.com", "type": "website" },
    { "name": "HubSpot Investor Relations", "url": "https://ir.hubspot.com", "type": "financial" }
  ]
}
```

Despite the prompt saying "Return ONLY the JSON," LLMs sometimes prepend prose or wrap in fences — which is why `extractJSON` above handles those cases.

### What your app needs to build (rule sets)

- **Rule set trigger logic:** Application code that decides when to invoke a rule set (e.g., after a form submission, when the user clicks "Analyze", or automatically based on app state).
- **Variables mapping:** Map your app's data model to the `variables` object expected by each rule set's prompt template. Check `session.ruleSets` on session open to know which rule sets are available and document their expected variables.
- **Structured response parsing:** Parse the JSON (or other format) from the AI's response after streaming completes.
- **Session re-use:** A single chat session can invoke many different rule sets in sequence. Open once, invoke many times.

---

## 12. What Lovable developers need to build

This section summarizes the **UI components and flows** your Lovable app needs to support the full integration. Not all are required — pick what applies to your use case.

### Always needed

- **Edge Function:** Deploy `ai-admin-supabase-edge-function.ts` (or your own version) with `AI_ADMIN_API_KEY` and `AI_ADMIN_BASE_URL` secrets.
- **Error handling:** Display user-friendly error messages. AI Admin returns `{ "error": "..." }` on failures. Error messages are sanitized (no internal details). Branch on HTTP status codes, not message text.

### For completion / one-shot AI calls

- A way to call `ask-ai-profile` or `run-processing-job` and display the result.
- Parse the response: show `formatted` (preferred) or `raw` text.

### For streaming chat

- A chat UI that calls `open-chat-session` on mount / conversation start.
- A message input that calls `send-chat-message-stream` via `fetch` (**not** `supabase.functions.invoke()` — it doesn't support streaming) and reads the SSE stream.
- Use the `streamAiAdminSSE` parser from §6 to handle all event types with typed callbacks.
- Append text deltas to the assistant's message bubble as they arrive (typing effect).
- (Optional) Show typing indicators while streaming.

### For workflows (structured steps in chat)

- **Step trigger logic:** Application code that decides when to trigger a workflow step (e.g., after a form submission, button click, or automated analysis). Use the `steps` array from the session to know which steps are available and what their dependencies are.
- **Variables mapping:** Map your app's data into the `variables` object expected by each step's prompt template. Inspect the workflow's `inputVariables` to know what the workflow expects at session start.
- **Step progress indicator:** Use the `steps` array from `open-chat-session` to show which steps are available, completed, or blocked by dependencies. Steps with `dependsOn` cannot be triggered until those dependencies complete — the server returns `400` if you try.
- **Structured response parsing:** If a step expects JSON output, parse the AI's streamed response as JSON after streaming completes. Output mappings handle this server-side for the variable pipeline, but you may also want to parse it client-side for UI rendering.
- **Variable pipeline awareness:** You do not need to manually pass outputs between steps. The variable pipeline handles cross-step data flow automatically. Just provide the initial workflow input variables when triggering the first step. Auto-captured `{stepKey}.prompt` and `{stepKey}.response` variables are always available for subsequent steps.
- **Error handling:** If a step's dependencies are not met, the server returns `400`. If the session is processing another message, it returns `409`. Handle both in your UI — show a clear message and retry logic.
- **When NOT to use workflows:** If you only need a single structured prompt with no follow-up conversation, use `run-processing-job` instead. If you need multiple named prompts without ordering, use rule sets (§11). Workflows are for multi-step pipelines where conversation context and data flow between steps matter.

### For rule sets (multiple named prompts in a chat job)

- **Rule set trigger logic:** Application code that decides when to invoke each rule set (e.g., after a button click or form submission).
- **Variables mapping:** Map your app data to the `variables` expected by the rule set's template. Inspect `session.ruleSets` on session open to know which keys are available.
- **Structured response parsing:** Parse the AI's JSON response after streaming completes.
- **Session re-use:** Open one session, invoke multiple rule sets across the conversation. See §11 for full documentation.

### For MCP tools (Gmail, Drive, etc.)

These components are only needed if your AI profiles use MCP tools that access user data. See §6 for the complete event reference, parser code, and UX examples.

- **API key input form:** A secure input where users paste their personal Devs.ai API key. Call `store-user-credential` on submit. Store no secrets in your frontend — the key is encrypted and stored by AI Admin.
- **Connection status display:** On the chat or settings page, show which MCP tools are connected. Call `check-tool-auth` for each relevant tool and show green/red status badges.
- **OAuth connect button:** For tools with `hasToken: false`, show a "Connect" button. On click, call `initiate-tool-oauth` and open the `authUrl` in a popup. After the user returns, re-check with `check-tool-auth`. See §6 "OAuth auth link handling" for the mid-stream variant.
- **Tool activity indicators:** Use the `onToolCall` / `onToolResult` callbacks from the §6 SSE parser. Show inline status messages like "Searching Gmail..." with a spinner. See §6 "Tool call visibility" for three display modes and a user-facing settings pattern.
- **Mid-stream OAuth prompts:** Handle `onToolMessage` events where `requiresUserAction: true` and `authUrl` is present. See §6 for a complete React component.
- **Suggested actions:** Handle `onSuggestedActions` events — render as clickable chips below the AI's response. See §6 for the component pattern.
- **"Requires personal credentials" gate:** Before opening a chat with a job that has `requires_user_credentials: true`, check if the user has stored their provider key. If not, show the API key input form first. (This flag is set on the processing job, not the AI profile.)

### For file attachments (sending files to AI)

These components let users attach files to messages or jobs:

- **File input / attachment button:** An `<input type="file">` wired to Supabase Storage upload + signed URL generation. Use the `useFileUpload` hook from §9.
- **Supabase Storage bucket:** Create a bucket (e.g. `chat-attachments`) in your Supabase project. The bucket can be private — signed URLs handle access.
- **Attachment preview:** Before sending, show the file name and size. Validate against the 5 MB limit client-side.

### For AI-generated files (receiving files from AI)

- **SSE file event handler:** Parse `files` events in the SSE stream (see §9 code example) and show download links or inline previews.
- **File download links:** Display clickable links for each generated file. URLs are publicly accessible — a simple `<a href={url} download>` works.
- **Session file gallery (optional):** Use `list-chat-files` mode to build a gallery of all files from a conversation, including both uploaded and AI-generated files.

### What end-users need to know

Your app should communicate these things to users (in your own words/UI):

1. **Why a personal API key?** "To access your email and documents, we need your personal Devs.ai account key. This keeps your data private — only you can access your own Gmail, Drive, etc."
2. **Where to get the key:** Link to Devs.ai account settings or provide instructions.
3. **OAuth authorization:** "You'll be asked to authorize Google access. This is a one-time step per service. You can revoke it anytime from your Google account settings."
4. **Security:** "Your API key is encrypted and stored securely. It is never shared with other users or visible to administrators."
5. **File attachments:** "You can attach files (up to 5 MB) to your messages. Files are securely uploaded and analyzed by the AI." (Only mention if your app uses file attachments.)

---

## 13. Production patterns — resilience, caching, and error handling

These patterns are **strongly recommended** for any Lovable app that goes beyond a prototype. They solve retry logic, deduplication, caching, abort support, rate limit handling, and structured errors — all on the client side. No AI Admin backend changes are required.

### Recommended architecture: React Query

Use [TanStack React Query](https://tanstack.com/query) (`@tanstack/react-query`) for all non-streaming AI Admin calls. It solves several problems at once:

| Problem | React Query solution |
|---------|---------------------|
| Retry with backoff | Built-in `retry` + `retryDelay` options |
| Request deduplication | Automatic — same query key = one in-flight request |
| Response caching | Built-in `staleTime` + `gcTime` |
| Per-call state | Each `useQuery`/`useMutation` has its own state — no singleton conflicts |
| Loading/error states | Built-in `isLoading`, `isError`, `error` |

> **SHOULD:** Use `useMutation` for `run-processing-job` and `ask-ai-profile`. Use `useQuery` for read operations like `check-tool-auth` and `list-chat-files`. Keep streaming (`send-chat-message-stream`) in a custom hook with `fetch` + the §6 SSE parser — React Query does not handle streams.

### Typed error handling

AI Admin returns standard HTTP status codes. Parse them into typed errors so your UI can show contextual recovery actions:

```typescript
// src/lib/ai-admin-errors.ts

export class AiAdminError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'AiAdminError';
  }
}

export class AuthError extends AiAdminError {
  constructor(message: string) {
    super(message, 401, 'AUTH_ERROR', false);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AiAdminError {
  constructor(message: string) {
    super(message, 403, 'FORBIDDEN', false);
    this.name = 'ForbiddenError';
  }
}

export class RateLimitError extends AiAdminError {
  retryAfterMs: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message, 429, 'RATE_LIMIT', true);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterSeconds * 1000;
  }
}

export class ValidationError extends AiAdminError {
  details?: { path: string; message: string }[];
  constructor(message: string, details?: { path: string; message: string }[]) {
    super(message, 400, 'VALIDATION', false);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class UpstreamError extends AiAdminError {
  constructor(message: string) {
    super(message, 502, 'UPSTREAM', true);
    this.name = 'UpstreamError';
  }
}

/**
 * Parse an Edge Function response into a typed error.
 * Call this when response.ok is false.
 */
export async function parseAiAdminError(response: Response): Promise<AiAdminError> {
  let body: { error?: string; message?: string; details?: { path: string; message: string }[] } = {};
  try { body = await response.json(); } catch { /* non-JSON error */ }
  const msg = body.error || body.message || `HTTP ${response.status}`;

  switch (response.status) {
    case 401: return new AuthError(msg);
    case 403: return new ForbiddenError(msg);
    case 429: {
      const retryAfter = Number(response.headers.get('Retry-After')) || 60;
      return new RateLimitError(msg, retryAfter);
    }
    case 400: return new ValidationError(msg, body.details);
    case 502:
    case 503:
    case 504: return new UpstreamError(msg);
    default: return new AiAdminError(msg, response.status, 'UNKNOWN', response.status >= 500);
  }
}
```

AI Admin returns `Retry-After` headers on 429 responses (rate limit) with the number of seconds to wait. The `RateLimitError` class captures this so your retry logic can respect it.

> **MUST:** Always branch on `error.code` (derived from HTTP status) rather than `error.message` text. Error messages are sanitized server-side and may change between versions. The `parseAiAdminError` function above gives you stable, typed error classes — use `instanceof` or `error.code` for control flow.
>
> **Validation details:** When the server returns HTTP 400 with a `details` array, `ValidationError.details` contains per-field errors with `{ path, message }`. Use this to display field-level validation feedback in your forms (e.g. highlight the field at `path` and show the `message`).

### React Query setup with retry and caching

```typescript
// src/lib/ai-admin-queries.ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { parseAiAdminError, RateLimitError } from './ai-admin-errors';

const EDGE_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-admin`;

async function callAiAdmin(body: Record<string, unknown>, jwt: string) {
  const response = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await parseAiAdminError(response);
  return response.json();
}

/**
 * Run a processing job. Retries transient errors with exponential backoff.
 * Rate limit errors respect the server's Retry-After header.
 */
export function useRunJob(jwt: string) {
  return useMutation({
    mutationFn: (params: { jobId: string; variables: Record<string, string> }) =>
      callAiAdmin({
        mode: 'run-processing-job',
        jobId: params.jobId,
        variables: params.variables,
        callingApplication: 'lovable:my-app',
      }, jwt),
    retry: 3,
    retryDelay: (attempt, error) => {
      if (error instanceof RateLimitError) return error.retryAfterMs;
      return Math.min(1000 * 2 ** attempt, 30_000); // exponential backoff, max 30s
    },
  });
}

/**
 * Check tool auth status. Cached for 30 seconds — multiple components
 * can call this without redundant requests.
 */
export function useCheckToolAuth(jwt: string, profileId: string, toolId: string) {
  return useQuery({
    queryKey: ['tool-auth', profileId, toolId],
    queryFn: () => callAiAdmin({
      mode: 'check-tool-auth',
      profileId,
      toolId,
    }, jwt),
    staleTime: 30_000,
    retry: 2,
  });
}
```

### Abort support and timeouts for completions

Completion calls (`run-processing-job`, `ask-ai-profile`) can take 10-60 seconds depending on the model and prompt size. Add abort support so users can cancel, and add a timeout so the UI doesn't hang indefinitely:

```typescript
export function useRunJobWithAbort(jwt: string) {
  const abortRef = useRef<AbortController | null>(null);

  const mutation = useMutation({
    mutationFn: async (params: { jobId: string; variables: Record<string, string> }) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // 90-second timeout — adjust based on your typical response times
      const timeout = setTimeout(() => controller.abort(), 90_000);

      try {
        const response = await fetch(EDGE_FN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
          },
          body: JSON.stringify({
            mode: 'run-processing-job',
            jobId: params.jobId,
            variables: params.variables,
            callingApplication: 'lovable:my-app',
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw await parseAiAdminError(response);
        return response.json();
      } finally {
        clearTimeout(timeout);
      }
    },
    retry: (count, error) => {
      if (error.name === 'AbortError') return false; // don't retry user cancellations
      return count < 3;
    },
  });

  const cancel = () => abortRef.current?.abort();

  return { ...mutation, cancel };
}
```

### Parallel job execution

To run multiple jobs simultaneously (e.g. "analyze 15 companies at once"), use `Promise.allSettled` so one failure doesn't cancel the rest:

```typescript
async function runJobsBatch(
  jobs: Array<{ jobId: string; variables: Record<string, string> }>,
  jwt: string,
  concurrency = 5,
): Promise<Array<{ status: 'fulfilled' | 'rejected'; value?: any; reason?: any }>> {
  const results: Array<any> = [];

  // Process in chunks to avoid overwhelming the API
  for (let i = 0; i < jobs.length; i += concurrency) {
    const chunk = jobs.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map((job) =>
        callAiAdmin({
          mode: 'run-processing-job',
          jobId: job.jobId,
          variables: job.variables,
          callingApplication: 'lovable:my-app',
        }, jwt),
      ),
    );
    results.push(...chunkResults);
  }
  return results;
}
```

The `concurrency` parameter controls how many requests run in parallel. Start with 5 — AI Admin's default LLM rate limit is 30 requests/minute per authenticated identity (API key or user), or 15 requests/minute per user when the per-user limit is configured. With 5 concurrent requests and typical 5–10 second response times, you stay well within both limits. If you hit 429s, reduce concurrency or increase the delay between chunks. Admins can adjust all rate limits in AI Admin → Settings → Rate Limits.

### UI patterns for error recovery

Use the typed errors to show contextual recovery actions:

```tsx
function ErrorDisplay({ error }: { error: AiAdminError }) {
  switch (error.code) {
    case 'AUTH_ERROR':
      return (
        <Alert variant="destructive">
          <p>Your session has expired.</p>
          <Button onClick={() => supabase.auth.signOut()}>Sign in again</Button>
        </Alert>
      );
    case 'RATE_LIMIT':
      return (
        <Alert variant="warning">
          <p>Too many requests. Retrying automatically...</p>
        </Alert>
      );
    case 'FORBIDDEN':
      return (
        <Alert variant="destructive">
          <p>{error.message}</p>
          <Button onClick={openCredentialForm}>Add your API key</Button>
        </Alert>
      );
    case 'UPSTREAM':
      return (
        <Alert variant="warning">
          <p>The AI service is temporarily unavailable. Please try again in a moment.</p>
        </Alert>
      );
    default:
      return <Alert variant="destructive"><p>{error.message}</p></Alert>;
  }
}
```

---

## 14. Anti-patterns — things you MUST NOT do

These are common mistakes. If you catch yourself doing any of these, stop and fix it.

> **NEVER** make `aiAdminHeaders()` accept an optional `userId` that defaults to `undefined`. The function MUST always require the `userId` parameter for user-context modes. If you make it optional, a forgotten argument silently breaks per-user credentials and MCP access with no error message.

> **NEVER** skip JWT validation on any Edge Function mode — including "app-context" completion modes (`ask-ai-profile`, `run-processing-job`). The JWT proves the request came from your app. Without it, anyone who discovers your Edge Function URL can call AI Admin using your API key.

> **NEVER** hardcode API keys, base URLs, or secrets in frontend React code. These belong in Supabase Edge Function secrets only. If you need a URL in the frontend, use `import.meta.env.VITE_SUPABASE_URL` (set by the Supabase integration) and construct the Edge Function URL from it.

> **NEVER** use `supabase.functions.invoke()` for `send-chat-message-stream` or `submit-tool-outputs`. It does not support streaming. Use `fetch()` with `ReadableStream` (see §6).

> **NEVER** display the `messageSent` field from completion responses to end-users. It contains the full interpolated prompt, including system instructions, variable values, and potentially sensitive context. Show `formatted` or `raw` only.

> **NEVER** store the user's Devs.ai API key in your own database, localStorage, or app state beyond the initial form submission. Send it immediately to AI Admin via `store-user-credential` and discard it. AI Admin encrypts and stores it.

> **NEVER** assume tool events (`tool.call`, `tool.result`, `tool.message`) will always appear in the stream. They only fire for Devs.ai agent profiles with MCP tools. Your streaming code must work correctly when zero tool events are emitted.

> **NEVER** auto-execute suggested actions without user confirmation. Always wait for the user to click.

---

## 15. Session write restrictions

JWT (admin UI) callers can only **write** to sessions they own. The following endpoints return **403** if `session.user_id` does not match the JWT user:

- `POST /api/chat-sessions/:id/messages`
- `POST /api/chat-sessions/:id/tool-outputs`
- `PUT /api/chat-sessions/:id/reset`
- `PUT /api/chat-sessions/:id/close`

**Read and delete remain workspace-wide** — any authenticated member can view or delete any session.

API-key callers (Edge Functions) retain workspace-wide write access. API keys with `X-Forwarded-User-Id` are still scoped to the forwarded user's sessions.

## 16. Compliance data deletion (GDPR / CCPA)

AI Admin provides purpose-built endpoints for erasing user data. These can be called from an Edge Function mode if your application needs to offer user data deletion.

**Endpoints:**

| Endpoint | Deletes | Who can call |
|----------|---------|-------------|
| `DELETE /api/user-data/:userId` | All data: sessions, diagnostic logs, credentials | Self, or admin/owner targeting another member |
| `DELETE /api/user-data/:userId/sessions` | Chat sessions + messages only | Any workspace member |
| `DELETE /api/user-data/:userId/diagnostic-logs` | Diagnostic logs only | Any workspace member |
| `DELETE /api/user-data/:userId/credentials` | Provider credentials only | Self, or admin/owner targeting another member |

All endpoints require `{ "confirm": "DELETE_USER_DATA" }` in the request body.

**RBAC rules:** Deleting **credentials** or performing a **full purge** (all data) for another user requires the caller to be an **admin** or **owner** of the workspace. Members can always delete their own data. Sessions and diagnostic logs can be deleted by any workspace member regardless of target. If a non-admin member attempts to delete another user's credentials or perform a full purge, AI Admin returns **403**.

**Edge Function mode example:**

```typescript
case 'delete-user-data': {
  const { userId: targetUserId, scope } = payload;
  const path = scope && scope !== 'all'
    ? `/api/user-data/${targetUserId}/${scope}`
    : `/api/user-data/${targetUserId}`;
  const upstream = await fetch(`${AI_ADMIN_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { ...aiAdminHeaders(userId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE_USER_DATA' }),
  });
  return jsonResponse(await upstream.json(), upstream.status);
}
```

**Response**: `{ deleted: { sessions?: number, diagnosticLogs?: number, credentials?: number } }`

---

## 17. Errors

> **Error messages are sanitized.** AI Admin never exposes internal details (database constraint names, table names, stack traces) in HTTP error responses. Error bodies contain user-safe descriptions only. **Always branch on HTTP status codes, not error message substrings.** Message text may change between versions without notice.

- HTTP **401** from AI Admin: bad or missing API key. See §13 `AuthError` for typed handling.
- HTTP **403**: the operation is not permitted. Common causes: the profile/job requires personal credentials and none are stored; the user lacks the required role (see §16 RBAC). See §13 `ForbiddenError`.
- HTTP **429** — rate limited. AI Admin returns a `Retry-After` header with seconds to wait. See §13 `RateLimitError` for automatic retry with backoff.
- **400** from Edge Function: missing `profileId`, `jobId`, `userId`, `sessionId`, etc. — read `error` in JSON body. Also returned by AI Admin if `X-Forwarded-User-Id` is present but not a valid UUID. See §13 `ValidationError`.
- **502/503/504** — upstream AI provider unavailable. See §13 `UpstreamError` for retry logic.
- Supabase function logs: **Edge Functions → Logs** in dashboard.

---

## 18. Self-verification — diff-check instructions

After writing or modifying Edge Function or frontend code, the LLM MUST run these verification steps before considering the task complete:

1. **Auth check:** Grep for all `aiAdminHeaders(` calls in the Edge Function. Confirm every call that serves a user-context mode passes `userId`. If any call omits it, that is a bug — fix it before proceeding.

2. **Secret check:** Search the entire frontend codebase (all `.ts`, `.tsx`, `.js`, `.jsx` files) for `aim_sk_`, `AI_ADMIN_API_KEY`, and `AI_ADMIN_BASE_URL`. If any of these appear outside of the Edge Function file, that is a security bug.

3. **Streaming check:** Search for `supabase.functions.invoke` and confirm it is never used for `send-chat-message-stream` or `submit-tool-outputs` modes. These must use `fetch()`.

4. **JWT check:** Confirm every Edge Function mode calls `requireUserId` or equivalent JWT validation before making upstream requests. If any mode skips this, that is a security bug.

5. **Test contract:** For every mode you implemented or modified, verify the test cases from §4 "Test contracts per mode" would pass. Pay special attention to the `401` cases (no JWT) and `400` cases (missing required fields).

---

## 19. Source of truth

- **This handbook** (`AI_ADMIN_LOVABLE_INTEGRATION.md`) defines every API endpoint, request body, and response shape your Edge Function needs.
- **The Edge Function starter** (`ai-admin-supabase-edge-function.ts`, downloaded from AI Admin → Connect Lovable) is a working reference implementation that matches the modes in §4.
- **Enforcement rules** at the top of this document are non-negotiable. Any code that violates a `MUST` or `NEVER` rule is incorrect regardless of whether it "works."
- **Programmatic discovery:** Fetch `/docs/manifest.json` for a machine-readable index of all documentation with version info, audience tags, and changelog entries. Fetch `/llms.txt` for a lightweight LLM-friendly overview with document links.
- **Version tracking:** The `X-API-Version` header on every API response and the `version` field in `GET /api/health` report the running server version. Check `/docs/CHANGELOG.md` for release notes.

When in doubt, follow the endpoint paths and JSON shapes documented in this file.
