# AI Admin — Core Concepts

This document explains the building blocks of AI Admin: what each entity is, how they relate to each other, and how they work together to power AI-driven applications.

## Table of contents

| Section | When you need it |
|---------|------------------|
| [How Everything Fits Together](#how-everything-fits-together) | First read — entity hierarchy overview |
| [Providers](#providers) | Connecting LLM platforms (Devs.ai, Gemini) |
| [AI Profiles](#ai-profiles) | Choosing model/agent, completion vs chat mode |
| [Processing Jobs](#processing-jobs) | Prompt templates, config, execution flow |
| [Build Rules (Formatting Rules)](#build-rules-formatting-rules) | Post-processing LLM output |
| [Rule Sets](#rule-sets) | Multiple invokable prompts in one job |
| [Workflows](#workflows) | Multi-step pipelines with variable pipeline |
| [Choosing the Right Pattern](#choosing-the-right-pattern) | Job vs workflow vs chat decision |
| [Health Monitoring](#health-monitoring) | API and widget health checks |
| [Key Relationships](#key-relationships) | Quick reference diagram |

---

## How Everything Fits Together

> **Summary:** Workspace-scoped hierarchy from Providers → AI Profiles → Processing Jobs → Workflows. Read this first to understand how entities relate.

```
Workspace
 ├── Providers          (LLM platforms — Devs.ai, Google Gemini, etc.)
 │    └── LLM Models    (available models within a provider)
 │
 ├── AI Profiles        (a specific AI / model configuration on a provider)
 │    ├── Primary provider + model/agent
 │    └── Failover provider + model/agent (optional)
 │
 ├── Processing Jobs    (reusable prompt templates tied to a profile)
 │    ├── Build Rules   (formatting rules applied to AI output)
 │    └── Rule Sets     (multiple named prompts invokable in chat mode)
 │
 └── Workflows          (multi-step chat flows linking ordered jobs)
      └── Steps         (each step → a processing job, with dependencies)
```

Everything is scoped to a **workspace**. Teams share providers, profiles, and jobs within their workspace, and API keys are issued per workspace.

---

## Providers

> **Summary:** LLM platform connections (Devs.ai, Google Gemini) with encrypted API keys and model catalogs.

A **provider** represents an LLM platform that AI Admin connects to.

### What It Stores

| Field | Purpose |
|-------|---------|
| **Name** | Human-readable label (e.g. "Production Devs.ai") |
| **Type** | `devs-ai` or `google-gemini` — determines which client library is used |
| **Base URL** | The provider's API endpoint |
| **API Key** | Platform credentials, encrypted at rest with AES-256-GCM |
| **Request Timeout** | Optional per-provider timeout override (milliseconds) |
| **Is Active** | Toggle to disable without deleting |

### Supported Provider Types

- **Devs.ai** — Supports agents with MCP tools, OAuth integrations, data sources, and model-based chat. This is the richest integration.
- **Google Gemini** — Direct model access via the Gemini API. Profiles on Gemini providers are automatically set to "model" type.

### How API Keys Are Protected

Provider API keys are encrypted before being stored in the database using AES-256-GCM (via the `CREDENTIAL_ENCRYPTION_KEY` environment variable). The encryption key is required in all non-development environments — the server will not start without it. API keys are completely stripped from all API responses; they never appear in any form.

---

## AI Profiles

> **Summary:** A configured model or agent on a provider — controls completion vs chat, runtime options, failover, and per-user credentials.

An **AI profile** is a configured identity on a provider — it points to a specific model or agent and carries settings that control how it behaves.

### What It Stores

| Field | Purpose |
|-------|---------|
| **Name** | Human-readable label (e.g. "Claude Opus — Company Research") |
| **Slug** | Optional stable identifier for config-as-code sync (unique per workspace) |
| **Provider** | Which provider platform to use |
| **External AI ID** | The model ID or agent UUID at the provider |
| **Profile Type** | `agent` (Devs.ai agent with tools) or `model` (raw LLM model) |
| **Mode** | `completion` (one-shot responses) or `chat` (stateful conversations) |
| **Runtime Options** | Provider-specific behavior toggles |
| **Is Default** | Whether this is the workspace's default profile |
| **Requires User Credentials** | If true, end-users must store their own provider API key |
| **Failover Provider + AI ID** | Backup provider/model if the primary fails |
| **Failover Runtime Options** | Separate behavior settings for the failover |
| **Config** | JSONB — includes `toolJobs[]` for jobs-as-tools (see [Jobs-as-Tools](#jobs-as-tools)) |

### Profile Type: Agent vs Model

- **Agent** — A Devs.ai agent that can use MCP tools (Gmail, Google Drive, web search, etc.), access data sources, and maintain conversation context natively on the provider side.
- **Model** — A raw LLM model ID (e.g. `gemini-2.0-flash`, `GPT-5.2`). Used for direct model access without agent capabilities.

Google Gemini profiles are always forced to "model" type since Gemini doesn't have an agent concept.

### Mode: Completion vs Chat

- **Completion** — The profile processes a single prompt and returns a single response. Used by processing jobs for template-based tasks like data extraction, summarization, or classification.
- **Chat** — The profile supports multi-turn conversations with message history. Used for interactive applications where users have back-and-forth exchanges with the AI.

### Runtime Options

These are provider-specific toggles that modify AI behavior:

**Devs.ai profiles:**
- Built-in tools (web search, Python execution, spreadsheet, memory, sandbox)
- Citation generation
- Parallel tool calls

**Google Gemini profiles:**
- Grounding with Google Search

### Failover

Every profile can optionally designate a failover provider and model. If the primary provider returns an error or an empty response, AI Admin automatically retries with the failover before returning a failure to the caller. The failover can have its own runtime options.

### Per-User Credentials

When "Requires User Credentials" is enabled, end-users must register their own API key for the provider (through the application's UI). This enables per-user OAuth scoping — for example, each user's Devs.ai agent gets its own Google or Slack OAuth tokens, so user A's Gmail access is separate from user B's.

---

## Processing Jobs

> **Summary:** Reusable prompt templates with variables, formatting rules, and optional rule sets — the core unit for one-shot and chat AI calls.

A **processing job** is a reusable AI task. It combines a prompt template with an AI profile and formatting rules, creating a standardized, repeatable operation that applications can call by name.

### What It Stores

| Field | Purpose |
|-------|---------|
| **Name** | Human-readable label (e.g. "Company Profiler") |
| **Slug** | URL-safe identifier, unique per workspace (e.g. `company-profiler`) |
| **Description** | What this job does |
| **AI Profile** | Which profile (and therefore which provider/model) to use |
| **Is Active** | Toggle to disable without deleting |
| **Config** | JSONB containing the prompt template, variables, formatting rules, and advanced settings |
| **Calling Application** | Which external app uses this job (for analytics) |

### The Config Object

The `config` field is the heart of a processing job. It contains:

**Prompt Template** — A text template with `{{variable}}` placeholders that get filled in at runtime:

```
Analyze the company {{companyName}} at {{domain}}.
Provide a brief overview of their business model.
```

**Variables** — Definitions for each placeholder the template expects:

| Field | Purpose |
|-------|---------|
| `name` | Variable key (matches `{{name}}` in the template) |
| `label` | Human-readable label for the UI |
| `source` | `user` (provided at runtime) or `pipeline` (injected by the system) |

**Formatting Rules** — Post-processing rules applied to the AI's raw output (see Build Rules below).

**Advanced Settings:**
- **Diagnostics** — Enable logging of request/response data for debugging (`one-time` or `always`)
- **Timeouts** — LLM call timeout and total operation timeout (overrides provider defaults)
- **Retries** — Number of retry attempts on failure
- **Caching** — TTL for response caching

**Rule Sets** — For chat-mode jobs, multiple named prompts that can be invoked during a conversation (see Rule Sets below).

### How a Job Executes

1. The caller sends a request with `variables` (and optionally `attachments`)
2. AI Admin loads the job, resolves the linked AI profile and provider
3. Variables are interpolated into the prompt template (each value is wrapped in `<user_input>` tags for prompt safety and truncated at 10,000 characters)
4. Attachments (if any) are downloaded and appended to the prompt
5. The composed prompt is sent to the LLM via the provider
6. The raw response passes through formatting rules
7. The formatted result is returned to the caller

If diagnostics are enabled, timing data, token usage, and request/response details are logged.

---

## Build Rules (Formatting Rules)

> **Summary:** Post-processing steps applied to raw LLM output (trim JSON, extract fields, etc.).

**Build rules** are post-processing transformations applied to the AI's raw output. They clean, extract, or restructure the response into the format your application needs.

### Available Rule Types

| Rule Type | What It Does |
|-----------|--------------|
| `remove-reasoning` | Strips thinking/reasoning tags and pre-JSON preamble from the response |
| `remove-footnote-tags` | Removes `<#1#>`, `<#2#>` style footnote markers |
| `remove-custom-tags` | Removes specified HTML-like tags (configurable tag name) |
| `extract-between-tags` | Extracts only the content between specified tags |
| `trim-leading-spaces` | Removes leading whitespace from each line |
| `trim-trailing-spaces` | Removes trailing whitespace from each line |
| `trim-leading-linebreaks` | Strips blank lines from the start of the output |
| `trim-trailing-period` | Removes a trailing period |
| `trim-to-csv` | Isolates the CSV block from surrounding text |
| `trim-to-json` | Isolates and parses a JSON block from surrounding text |
| `uppercase` | Converts the entire response to uppercase |
| `lowercase` | Converts the entire response to lowercase |
| `sentence-case` | Capitalizes the first letter of each sentence |
| `csv-to-json` | Parses CSV content into a JSON array |
| `repair-json` | Attempts to fix malformed JSON |
| `repair-csv` | Attempts to fix malformed CSV |
| `require-keys` | Assert top-level JSON keys are present and non-empty; emits `{ verified: false, reason: "missing_keys" }` on failure |
| `assert-json-schema` | Validate against a flat schema (types, required, enums); deterministic contract check |
| `coerce-types` | Normalize top-level field types (string→number/boolean) |
| `constrain-enum` | Assert field values are in an allowed set |

**Assertion rules** (last four) are for output contracts — they fail loudly instead of passing malformed data downstream. Chain after `trim-to-json` and `repair-json`.

### How Rules Are Applied

Rules are applied **in order**. Each rule's output becomes the next rule's input. For example, a common chain might be:

1. `remove-reasoning` — strip the AI's thinking process
2. `trim-to-json` — extract just the JSON from the response
3. `repair-json` — fix any structural issues

### Streaming-Safe Rules

During SSE chat streaming, only two rules can be applied to content as it arrives (delta-by-delta): `remove-footnote-tags` and `remove-reasoning`. All other rules require the complete response and are applied only to the accumulated content after the stream completes.

### Where Rules Are Configured

- **Job-level** — In a processing job's `config.formattingRules` (applies to all executions of that job)
- **Per rule set** — Each rule set within a chat-mode job can have its own `formattingRules`
- **Per request** — The AI Matcher endpoint accepts `formattingRules` in the request body

---

## Rule Sets

> **Summary:** Named sub-prompts inside a chat-mode job, invoked by `ruleSetKey` — not separate database entities.

**Rule sets** allow a single chat-mode processing job to host multiple structured prompts that a calling application can invoke by name during a conversation. Instead of creating separate jobs for each task, you define rule sets within one job.

### When to Use Rule Sets

Use rule sets when your chat application needs to trigger different structured operations within the same conversation. For example, a customer support bot might have rule sets for:
- `summarize-ticket` — Summarize the conversation so far
- `suggest-resolution` — Generate resolution suggestions based on context
- `draft-response` — Write a customer-facing reply

Each has its own prompt template, variables, and formatting rules, but they all share the same chat session and conversation history.

### Identification

Rule sets are **not** standalone database entities — they have no UUID and no dedicated API routes. Each rule set is a JSON object inside the parent job's `config.ruleSets` array, identified solely by its **key** string. To invoke a rule set, pass `ruleSetKey` in a chat message. To update a rule set, use `PUT /api/processing-jobs/:id` with the full `config.ruleSets` array (arrays are replaced, not merged — always read-modify-write).

### What a Rule Set Contains

| Field | Purpose |
|-------|---------|
| **Key** | Stable string identifier used in API calls (e.g. `summarize-ticket`) — this is the only identifier, not a UUID |
| **Name** | Human-readable label |
| **Description** | What this rule set does |
| **Prompt Template** | Text with `{{variable}}` placeholders |
| **Variables** | Definitions for template placeholders |
| **Expected Format** | Hint for the expected output format (e.g. `json`, `text`) |
| **Formatting Rules** | Post-processing rules specific to this rule set |
| **Test Data** | Default variable values for testing in the UI |

### How Rule Sets Work

1. A chat session is opened with a chat-mode processing job
2. The `open-chat-session` response includes a `ruleSets` array listing available keys, names, and descriptions
3. To invoke a rule set, the caller sends `{ "ruleSetKey": "summarize-ticket", "variables": { ... } }` instead of a regular message
4. AI Admin resolves the rule set, interpolates variables into its prompt template, and sends it to the AI
5. The rule set's formatting rules are applied to the response
6. The `rule_set_key` is recorded on the chat message for traceability

Rule set invocations, free-form messages, and workflow steps are all mutually exclusive — each message uses exactly one trigger type.

---

## Workflows

> **Summary:** Ordered multi-step chat flows linking processing jobs with input/output variable mappings and dependencies.

A **workflow** chains multiple processing jobs into an ordered, multi-step chat flow with dependency management. It's designed for guided processes where each step builds on previous ones.

### What a Workflow Stores

| Field | Purpose |
|-------|---------|
| **Name** | Human-readable label (e.g. "Customer Onboarding") |
| **Slug** | URL-safe identifier, unique per workspace |
| **Description** | What this workflow accomplishes |
| **AI Profile** | Default profile for the workflow (steps can override via their linked job) |
| **Config** | JSONB for workflow-level settings — includes `inputVariables` (the variables the calling app provides at workflow start) and optional `systemPrompt` |
| **Is Active** | Toggle to disable without deleting |

### Workflow Steps

Each step in a workflow links to a processing job and defines ordering and dependencies:

| Field | Purpose |
|-------|---------|
| **Step Key** | Stable identifier (e.g. `gather-requirements`) |
| **Name** | Human-readable label |
| **Processing Job** | Which job to execute when this step is triggered |
| **Sort Order** | Display and default execution order |
| **Is Required** | Whether this step must be completed |
| **Depends On** | Array of step keys that must complete before this step can run |
| **Config** | Step-level overrides — includes `inputMappings` (workflow var → job var) and `outputMappings` (job output field → workflow var) |

### Variable Pipeline

Workflows support an automatic variable pipeline that threads data between steps:

1. **Workflow Input Variables** — declared in the workflow's `config.inputVariables`. These are the variables the calling application supplies when starting the workflow.
2. **Input Mappings** — each step can map workflow-level variable names to the job's expected variable names via `config.inputMappings`. Before interpolation, the accumulated variables are translated through these mappings.
3. **Output Mappings** — each step can extract fields from the LLM's JSON response and save them as workflow-level variables via `config.outputMappings`. AI Admin parses the response as JSON and maps keys using dot/bracket paths (e.g. `"analysis.score": "lead_score"`, `"items[0].title": "first_item"`) or simple top-level keys. The merge is atomic (Postgres `jsonb ||`) so concurrent steps cannot overwrite each other's outputs.
4. **Accumulated Variables** — stored in `chat_sessions.workflow_variables` (JSONB), this accumulator grows after each step. Later steps can consume variables produced by earlier steps.

This allows independent processing jobs (which may use different variable names) to be connected together in a workflow without modification.

> **Path syntax:** Top-level keys work as before (`"score": "lead_score"`). Nested extraction uses dot/bracket paths in the mapping key — the resolved value (which may be nested) is stored whole under the workflow variable name.

### How Dependencies Work

Dependencies are expressed as an array of step key strings. When a step is triggered:

1. AI Admin checks which steps have already been completed in the session (a step is "completed" when a user message with that step's ID exists in the chat history)
2. If any dependency step hasn't been completed, the request is rejected with an error listing the missing prerequisites
3. If all dependencies are satisfied, the step's processing job prompt is composed and sent to the AI

This enables flows like:

```
Step 1: gather-requirements     (no dependencies)
Step 2: analyze-requirements    (depends on: gather-requirements)
Step 3: propose-solution        (depends on: gather-requirements, analyze-requirements)
Step 4: generate-report         (depends on: propose-solution)
```

### How a Workflow Session Works

1. Open a chat session with `workflowSlug` or `workflowId`
2. The response includes a `steps` array with each step's key, name, sort order, and dependencies
3. Trigger steps by sending `{ "stepKey": "gather-requirements", "variables": { ... } }`
4. Between steps, users can send free-form messages for clarification
5. AI Admin enforces dependencies automatically — steps that have unmet prerequisites return a clear error

The workflow's AI profile provides the LLM connection, while each step's linked processing job provides the prompt template and formatting rules for that specific task.

### Resuming a Conversation

Chat sessions are durable. Closing a session marks it `closed` but **preserves** both the local history and the provider's remote chat (e.g. the Devs.ai chat id), so an end user can return later and continue where they left off. To resume, call `POST /api/chat-sessions/resume` with either the AI Admin `sessionId` or the provider's `externalChatId`. The session is reactivated (idempotent if already active), the remote chat is validated, and the response restores the local `messages`, `completedSteps`, and `workflowVariables` so mid-workflow pipelines pick up exactly where they stopped. (There is nothing to resume for one-shot completion jobs — only streaming chat sessions carry state.)

---

## Triggers

> **Summary:** Run a job or open a workflow session on a schedule or when internal events fire.

A **trigger** binds a slug to a target job or workflow. Triggers can be:

- **External clock** (`external_clock`) — invoked by `POST /api/triggers/:slug/run` from Vercel cron, GitHub Actions, or manual calls. Use for nightly reports, scheduled enrichment, etc.
- **Event-driven** — `session.message.created` or `workflow.step.completed` fire automatically from chat post-stream hooks when configured.

Each trigger stores `target_type` (`job` | `workflow`), `target_slug`, optional `config.defaultVariables`, and `is_active`.

---

## Jobs-as-Tools

> **Summary:** Expose processing jobs as callable tools on a chat profile.

Set `ai_profiles.config.toolJobs[]` to `{ jobSlug, exposeAs, description? }`. During streaming chat, AI Admin registers these as Devs.ai tools (parameters derived from the job's input variables). When the model emits a matching `tool.call`, AI Admin runs the job internally and submits the result — no client round-trip for registered tool jobs.

Use this when the model should decide *when* to run a structured extraction or lookup, while staying in a conversational session.

---

## Session Compaction

> **Summary:** Summarize older turns when context grows too large.

Set `chat_sessions.config.summarizer` to `{ jobSlug, triggerTokens?, keepLastNTurns? }`. Before each message, AI Admin estimates session tokens; when over `triggerTokens` (default 8000), it runs the summarizer job on older turns (keeping the last N turns intact) and stores the result in `session_summary`. Subsequent prompts prepend the summary so long conversations stay within context limits.

---

## Config-as-Code

> **Summary:** Version-control AI Admin configuration and sync by slug.

Profiles, processing jobs, and workflows can carry a workspace-unique `slug`. `POST /api/sync` upserts arrays of these entities idempotently — create if missing, update if present. Use `dryRun: true` to preview the diff. The CLI `backend/scripts/ai-admin-sync.mjs` wraps the same endpoint for CI/CD pipelines.

Pair with `POST /api/processing-jobs/:id/eval` to run golden test cases before promoting config changes.

---

## Choosing the Right Pattern

> **Summary:** Decision guide — use a single job for one-shot tasks, workflows for multi-step pipelines with data dependencies, chat sessions for interactive streaming.

| Scenario | Use |
|----------|-----|
| One-off prompt against a configured model | **AI Profile** via `run-slot` |
| Repeatable templated task (extract, classify, summarize) | **Processing Job** |
| Interactive multi-turn conversation | **AI Profile** or **Processing Job** in chat mode |
| Chat with multiple structured operations | **Processing Job** with **Rule Sets** |
| Guided multi-step process with dependencies | **Workflow** |

---

## Health Monitoring

> **Summary:** API-based and browser-based health checks with profiles, runs, incidents, and uptime dashboards.

AI Admin includes a built-in health monitoring system that continuously verifies your AI providers and embedded chat widgets are operational. It tracks uptime, detects outages, and surfaces failure patterns — all scoped to the workspace like everything else.

### How the Monitoring Stack Fits Together

```
Workspace
 ├── Provider Keys          (user-scoped API keys for health checking)
 │
 ├── Health Check Profiles  (AI model/agent configs used for probing)
 │    └── Provider Key      (which key to authenticate with)
 │
 ├── Health Checks          (API-based monitors, one per profile)
 │    ├── Runs              (individual check executions)
 │    └── Incidents         (outage tracking with state machine)
 │
 └── Widget Health Checks   (Puppeteer-based browser automation)
      ├── Runs              (individual check executions + screenshots)
      └── Incidents         (outage tracking with state machine)
```

---

### Provider Keys

A **provider key** is a user-scoped API key used exclusively by the health checker to authenticate against AI providers. These are separate from the main provider API keys so that health monitoring has its own credentials.

| Field | Purpose |
|-------|---------|
| **Name** | Human-readable label (e.g. "Health Check — Devs.ai Prod") |
| **Provider** | Which provider this key authenticates against |
| **API Key** | The credential, encrypted at rest with AES-256-GCM |
| **User** | The user who owns this key (resolved automatically) |
| **Is Active** | Toggle to disable without deleting |

Provider keys are encrypted before storage and stripped from all list API responses. They are never exposed in their raw form outside the server.

---

### Health Check Profiles

A **health check profile** defines which AI model or agent the health checker should probe. It is structurally similar to an AI profile but exists in a separate table specifically for monitoring.

| Field | Purpose |
|-------|---------|
| **Name** | Human-readable label (e.g. "GPT-5.2 — Prod Check") |
| **Provider** | Which provider platform to call |
| **Provider Key** | Which health-check-specific API key to use |
| **External AI ID** | The model ID or agent UUID at the provider |
| **Profile Type** | `agent` or `model` |
| **Mode** | `completion` or `chat` |
| **Runtime Options** | Provider-specific behavior toggles |
| **Is Active** | Toggle to disable without deleting |

When a profile is created, a default health check is automatically created alongside it (5-minute cadence, 2-minute outage cadence). Renaming or toggling a profile syncs those fields to its linked health check, and vice versa.

---

### Health Checks (API-Based)

A **health check** is a scheduled API-based monitor. It periodically sends a test message to the linked profile's model and evaluates whether a valid response comes back.

| Field | Purpose |
|-------|---------|
| **Name** | Human-readable label |
| **Health Check Profile** | Which profile (provider + model + key) to probe |
| **Test Message** | The prompt sent to the model (default: "Hello, please confirm you are operational.") |
| **Cadence (minutes)** | How often to run under normal conditions (1–1440) |
| **Outage Cadence (minutes)** | How often to run during an active incident (typically shorter) |
| **Is Active** | Toggle to pause monitoring |
| **Last Run At** | Timestamp of the most recent execution |

#### Scheduling

**Local / long-running server:** An in-process scheduler polls every 60 seconds, compares `last_run_at` against each check's cadence, and runs due checks. During an active incident, the outage cadence is used instead, enabling more frequent probing while the provider is down.

**Serverless (Vercel):** The in-process scheduler is disabled. Due checks run only when an external cron hits `GET /api/cron/tick/health` or `GET /api/cron/tick/widget` with `Authorization: Bearer CRON_SECRET`. See [API.md — Scheduled runs](API.md#scheduled-runs-vercel-cron). Manual runs remain available via `POST /api/health-checks/:id/run`.

---

### Widget Health Checks (Browser-Based)

A **widget health check** uses Puppeteer to automate a real browser session against an embedded chat widget. This catches issues that API-only checks miss: broken iframes, Shadow DOM rendering failures, JavaScript errors, and unresponsive send buttons.

| Field | Purpose |
|-------|---------|
| **Name** | Human-readable label |
| **URL** | The page containing the chat widget |
| **Test Message** | The message typed into the widget's input field |
| **Shadow Host Selector** | CSS selector for the Shadow DOM host element |
| **Launcher Selector** | CSS selector for the widget's open/launch button |
| **Iframe Selector** | CSS selector for the widget's iframe (if applicable) |
| **Input Selector** | CSS selector for the text input inside the widget |
| **Send Selector** | CSS selector for the send button |
| **Response Selector** | CSS selector for the response container |
| **Error Patterns** | Array of strings to detect in the response as errors (up to 20) |
| **Page Load Timeout** | How long to wait for the page to load (5s–600s) |
| **Response Timeout** | How long to wait for a reply after sending (10s–600s) |
| **Capture Screenshot** | Whether to save a screenshot on failure |
| **Max Retries** | How many retries before marking a failure (1–3) |
| **Cadence / Outage Cadence** | Same scheduling model as API health checks |

Widget checks support Shadow DOM traversal — the checker can pierce a shadow root to find the widget's internal elements. Screenshots captured on failure are uploaded to Supabase Storage (`widget-hc-screenshots` bucket) and stripped from list responses to keep payloads small. Each run includes a `has_screenshot` flag; retrieve the image via a dedicated endpoint that returns a time-limited signed URL.

---

### Runs

A **run** is a single execution of a health check (API or widget). Every run records:

| Field | Purpose |
|-------|---------|
| **Status** | `pass`, `fail`, `timeout`, or `error` |
| **Response Time (ms)** | End-to-end latency of the check |
| **Error Message** | Description of the failure (null on pass) |
| **Raw Response** | The AI's reply (for API checks) |
| **Screenshot** | PNG uploaded to Supabase Storage at failure time (widget checks only; retrieved via signed URL) |
| **Created At** | When the run was recorded |

Run history supports server-side filtering by status, date range, limit, and offset. Query parameters are validated with Zod schemas. Daily aggregation RPCs (`hc_daily_run_summary`, `widget_hc_daily_run_summary`) pre-compute pass/fail/timeout/error counts per day for dashboard visualizations.

---

### Incidents

An **incident** represents a detected outage — a period during which a health check is failing. The incident system follows a simple state machine:

```
[No incident]
     │
     ▼  (run fails, no open incident)
 ┌──────┐
 │ OPEN │ ← started_at set, failed_run_count = 1
 └──┬───┘
    │  (subsequent failures)
    │   → failed_run_count incremented
    │   → last_error updated
    │
    │  (run passes)
    ▼
┌──────────┐
│ RESOLVED │ ← resolved_at set, duration_seconds computed
└──────────┘
```

| Field | Purpose |
|-------|---------|
| **Started At** | When the first failure was detected |
| **Resolved At** | When the first passing run ended the outage (null while open) |
| **Duration (seconds)** | Computed from `resolved_at − started_at` |
| **Failed Run Count** | Number of consecutive failures during the incident |
| **Last Error** | Most recent error message |

Only one incident can be open per health check at a time. While an incident is open, the health check switches to its outage cadence for faster probing.

---

### Dashboard & Analytics

The health monitoring dashboard provides at-a-glance status and historical analytics:

**Health Status** — Each check is assigned a computed status based on recent runs and incident state:

| Status | Condition |
|--------|-----------|
| **Healthy** | Last run passed, no open incident, previous run also passed |
| **Degraded** | Last run passed, but the previous run failed (recovering) |
| **Down** | Last run failed, or an incident is currently open |
| **Unknown** | No runs recorded yet |

This logic lives in a shared `computeHealthStatus()` function used by both API and widget health check routes.

**Uptime History** — Daily run aggregates over a configurable window (up to 365 days), with per-check uptime percentages. Visualized as a heatmap on the frontend.

**Failure Patterns** — RPC-based analysis that groups error messages by frequency and charts failures by hour of day (UTC). Useful for identifying recurring issues or time-of-day patterns. These RPCs enforce `workspace_id` to prevent cross-tenant data access.

**Investigation Panel** — A drill-down UI for individual checks with three tabs: run history (filterable, paginated), incident timeline, and failure pattern analysis. Effects use `AbortController` cleanup to prevent stale state updates.

---

## Key Relationships

> **Summary:** Quick-reference of how all entities connect within a workspace.

- A **provider** supplies the LLM platform and credentials
- An **AI profile** points to a specific model/agent on a provider
- A **processing job** pairs a prompt template with an AI profile
- **Build rules** transform a job's output into the desired format
- **Rule sets** give a chat-mode job multiple invokable prompts
- A **workflow** sequences multiple processing jobs into ordered steps
- A **provider key** gives the health checker its own credentials for a provider
- A **health check profile** identifies which model/agent to probe
- A **health check** schedules periodic API probes against a profile
- A **widget health check** schedules browser-based probes against an embedded widget
- **Runs** record each individual check execution
- **Incidents** track outage windows from first failure to recovery
- A **workspace** owns all of the above and isolates them from other teams
