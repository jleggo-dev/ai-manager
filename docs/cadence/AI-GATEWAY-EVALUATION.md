# Vercel AI Gateway vs Devs.ai v2 — measured comparison

_2026-10-29. Read-only investigation plus live probes; nothing was repointed. For the owner to rule
on. Every model call in Cadence stays an AI Admin job either way — this is about which provider
AI Admin's engine talks to, not about bypassing it._

## The short answer

Devs.ai adds a fixed **~2,640 input tokens to every GPT call and ~4,820 to every Claude call**,
whatever we send and whatever `chat_mode` we set. It also adds **~0.8–1.0 s** per call, and it
**silently ignores our strict `json_schema`** on every model family. Through Vercel AI Gateway the same requests
bill only what we sent, come back in half the time, and enforce the schema on GPT and Claude. The
gateway charges provider list price with no markup.

**Recommendation: move AI Admin's jobs to the gateway first (a new provider type beside
`devs-ai-v2`, not a replacement), then the coach once streaming + caching are proven.** Details
and the open items are below. The per-meal check that food logging is moving to is the call
shape where the Devs.ai overhead hurts most: a small prompt with a schema.

## 1. Prompt-token overhead (the "bloat")

Same request, built by AI Admin's own `messagesToV2Request`, sent to both routes. "tiny" is
`Reply with the single word OK.`; "mid" is the same plus 4,016 characters of plain English.

| Model             | tiny: Devs.ai | tiny: Gateway | mid: Devs.ai | mid: Gateway | Added by Devs.ai |
| ----------------- | ------------: | ------------: | -----------: | -----------: | ---------------: |
| gpt-4.1-mini      |         2,657 |            14 |        3,522 |          879 |       **~2,643** |
| gpt-4o-mini       |         2,656 |            14 |        3,521 |          879 |           ~2,642 |
| gpt-5.2           |         2,661 |            13 |        3,526 |          878 |           ~2,648 |
| claude-sonnet-5-5 |         4,834 |            18 |        5,868 |        1,052 |       **~4,816** |

- The overhead is **fixed**. The 4,016 characters cost the same ~865 tokens on both routes, so the
  slope is normal and only the intercept differs.
- `chat_mode` `execute` / `chat` / omitted makes **no difference**: the same counts to the token.
  (`execute` is Devs.ai's default and what every profile sends.)
- Devs.ai's spec documents an injected org system prompt (`OrgPromptConfig`, "agentless" surface,
  max 4,000 characters). That alone cannot account for 2,640 tokens; the rest is their own
  preamble, which we can't see.
- The history agrees: across 90 days of `diagnostic_logs` (jobs send a single user message, no
  system prompt and no tools), tokens on prompt length show intercepts of ~2,650 on
  gemini-3.5-flash (n=634, r² 0.97) and ~2,575 on gemini-3.1-pro (r² 0.97). claude-sonnet-5
  billed 4,800 tokens for a 1,288-character prompt.

**What it costs.** For a per-meal check (~1,000-token prompt + schema on gpt-4.1-mini), Devs.ai
bills ~3,640 input tokens against ~1,190 on the gateway, about **3×**. On a 48k-token coach turn
the same overhead is ~10%.

## 2. Latency per call

Medians, same machine, same minutes, n=2–5 per cell:

| Model             | tiny: Devs.ai | tiny: Gateway | mid: Devs.ai | mid: Gateway |
| ----------------- | ------------: | ------------: | -----------: | -----------: |
| gpt-4.1-mini      |        1.68 s |        0.98 s |       1.88 s |       0.77 s |
| gpt-4o-mini       |        1.60 s |        0.96 s |       1.70 s |       0.94 s |
| gpt-5.2           |        1.70 s |        0.89 s |       1.96 s |       0.89 s |
| claude-sonnet-5-5 |        1.65 s |        1.36 s |       1.82 s |       0.84 s |

The gateway is about **0.8–1.0 s faster per call**. This is per round trip, so a coach turn with
tool rounds pays it on each round. Structured extraction (section 4) was a wash, because there
generation time dominates.

One gateway gpt-5.2 call hung 136 s and the next "fetch failed". A run of Devs.ai "fetch failed"
errors happened in the same minute, so it was most likely a local network blip. The 8 repeat
calls were all clean (0.7–0.9 s). n is small; treat as a pointer.

## 3. Prompt caching

| Route   | GPT (gpt-5.2)                        | GPT minis                                             | Claude Sonnet 5.5                                                                                                       |
| ------- | ------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Devs.ai | caches (7,552 / 8,076 on repeat)     | gpt-4.1-mini on 3rd call only; 4o-mini never reported | caches **only its own 4,749-token preamble** when our content is in the user turn                                       |
| Gateway | caches automatically (4,736 / 5,428) | not reported in 3 tries                               | via the Anthropic Messages endpoint: **6,472 / 6,488 read from cache** with `caching: 'auto'` or manual `cache_control` |

- Real coach turns through Devs.ai (claude-sonnet-5, 145 turns, Aug–Oct) averaged 47.8k prompt
  and 26.2k cached (55%). So Devs.ai does cache the coach's fixed instructions + tools. Jobs put
  everything in one user message, and there only Devs.ai's preamble caches.
- On the gateway **we decide where the cache breakpoint goes**. Its pricing lists cache reads at
  the provider rate (Sonnet 5.5: $0.10/M against $2/M input). Devs.ai doesn't expose a per-call
  cost, so whether it bills the discount through is still unanswerable from our side, as the
  2026-08-29 probe found.
- Open: `caching: 'auto'` did **not** take effect on the gateway's OpenAI-Responses endpoint for
  Claude; it did on its Anthropic-Messages endpoint. Either Claude goes through `/v1/messages`, or
  the correct Responses field must be confirmed before moving the coach.

## 4. Strict `json_schema` per family — the biggest surprise

Test: a strict schema that requires `{"marker": "zebra-alpha", "count": int}`, and a prompt that
asks for `{"ok": true}`. An enforced schema returns `zebra-alpha`; an ignored one returns
`{"ok": true}`.

| Family            | Devs.ai (execute / chat / omitted)                | Gateway                                          |
| ----------------- | ------------------------------------------------- | ------------------------------------------------ |
| gpt-4.1-mini      | **ignored** (input tokens identical with/without) | enforced                                         |
| claude-sonnet-5-5 | **ignored**                                       | enforced                                         |
| gemini-3.6-flash  | **ignored**                                       | not enforced (Responses or Chat endpoint) — open |

- **Our strict schema has never reached the model through Devs.ai.** The CLAUDE.md note that
  "strict json_schema is ~free on OpenAI, ~2.2× slower on Gemini via Devs.ai" was measuring
  something other than the schema. Our jobs get valid JSON because the prompts ask for it, not
  because anything enforces it.
- Moving to the gateway exposes a latent bug: OpenAI rejects what
  `expected-schema-to-json-schema.ts` generates, because nested `{type: object}` items are emitted
  with `additionalProperties: true`, and strict mode requires `false` on every object. 29 jobs in
  `config/ai-admin/ai-admin.config.json` carry an `expectedSchema`. Each needs either a closed
  schema or `strict: false` before it can run on the gateway.
- Cost of enforcement on the gateway: the schema adds its own tokens (+~190 for the capture
  schema on gpt-4.1-mini, +~390 on Claude). On Claude it was slower in this test (5.9 s vs 2.2 s
  median, n=3); on GPT it is negligible.

## 5. Catalogue reliability

- **Devs.ai today: 58 of 58 listed text models answered** a one-line prompt. Ten needed
  `max_output_tokens ≥ 100` (deepseek, glm, kimi, minimax, qwen), which is a request rule, not a
  dead model. The 2026-10-27 dead ids (claude-sonnet-5, gemini-3.5-flash, …) are no longer
  listed. The other 343 catalogue entries are custom-agent UUIDs, not models.
- **Gateway: 499 models listed**, prices published per model, including cache-read rates. Every
  model probed answered (gpt-4.1-mini, gpt-4o-mini, gpt-5.2, claude-sonnet-5.5, gemini-3.6-flash).
  A full liveness sweep was not run.
- The house rule still stands on either route: prove a model with a live call. AI Admin's
  "Check models answer" (`model-liveness.ts`) works for any client with `chatCompletion`, so it
  covers a gateway provider unchanged.

## What a migration would touch

The gateway speaks the OpenAI Responses dialect we already build, so most of the client is
reused.

1. **New provider type** `vercel-ai-gateway` in
   [`client-factory.ts`](../../backend/src/integrations/client-factory.ts) plus a client beside
   `devs-ai-v2/`. It reuses `messagesToV2Request` / `toolResultsToV2Request`, strips the Devs.ai
   extensions (`chat_mode`, `thread_mode`), and sends `store: false`. Provider row, encrypted key,
   and a provider-type switch in `ai-profile-runtime-options.ts`.
2. **Model ids** become `openai/gpt-4.1-mini`, `anthropic/claude-sonnet-5.5` and so on. Repoint
   profiles with `repoint-profile.ts`, one profile at a time. Failover can stay cross-provider:
   gateway primary, Devs.ai failover.
3. **Schemas**: close every object in `expected-schema-to-json-schema.ts` or send `strict: false`,
   and pin it with a test. Keep schema jobs off Gemini until gateway Gemini enforcement is proven.
4. **Coach streaming**: `sse-transform.ts` was written for Devs.ai's event stream. The gateway
   emits standard OpenAI Responses events, which need a fixture test (`capture-turn-frames.ts`
   pattern). `pauseV2ChatResponse` / `cancelV2ChatResponse` are Devs.ai endpoints; abort becomes
   client-side.
5. **Caching for Claude**: set breakpoints ourselves, or route Claude through `/v1/messages`
   (section 3, open item).
6. **Devs.ai-only features in use**: chat file uploads by `file_id` (`uploadChatSessionFile`, 2
   call sites; the gateway has no file store, so files go inline as data URLs), remote-chat purge
   (becomes a no-op), and the Research profile's built-in `web_search` (the gateway has its own
   web-search tool at $10/1k calls, which needs mapping).
7. **Unchanged**: `diagnostic_logs`, `ai_log`, the job/workflow engine, failover, liveness. The
   audit trail does not move.

Suggested order: (a) one Broker job, e.g. a per-meal check or capture extract, on a gateway
profile with Devs.ai failover, compared on the same inputs through the job `/test` route; (b) the
rest of the Broker jobs once schemas are fixed; (c) Evolve; (d) the coach last, after the streaming
and caching tests.

## For the owner to rule on

1. Add the gateway as a second provider and start with the Broker jobs? (Recommended.)
2. Close the job schemas so strict mode actually holds, even if we stay on Devs.ai, where the
   schema is ignored today anyway.
3. Whether the coach moves too, after the streaming and Claude-caching items above.
4. Billing: the gateway is pay-as-you-go credits at list price. Is there a Devs.ai plan/credit
   commitment that makes its per-token price differ from list? That cannot be seen from the API.

## How this was measured

Probes are in the session scratchpad (not committed): `devsai-overhead.mts` and `gateway.mts`
(same prompts, overhead/cache/schema phases), `schema-enforce*.mts`, `gw-anthropic-cache.mts`.
Each call was ~10–11k tokens at most; total spend was cents. History came from `diagnostic_logs`
(AI Admin DB, 90 days) and `cadence.ai_log` (coach, 75 days). Gateway key in
`apps/cadence-api/.env` (`AI_GATEWAY_API_KEY`); Devs.ai key from `backend/.env`.
