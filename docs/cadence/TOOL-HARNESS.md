# The coach's tool harness — the standard, and how we measure against it

The rules for `ai_harness_tools` — what the model calls. (`user_action_widgets`, what she *presents*,
are a different surface with their own catalog: `renderCoachToolCatalog`.)

Written 2026-08-16 after an audit against published guidance from Anthropic, OpenAI, the MCP spec
(revision `2026-07-28`), and the shipped GitHub and Sentry MCP servers. **Read this before adding a
tool.** Every rule below is either enforced in CI (`description-audit.test.ts`) or listed under
"Not yet enforced" — and the second list is the backlog, not a set of suggestions.

---

## Where we stand, measured

| | Ours today |
|---|---|
| Tools exposed every turn | **24** (18 reads + 6 actions) |
| Tool definitions per request | **~5,000 tokens**, serialized 18,380 chars |
| Read descriptions | 134–438 chars |
| Action descriptions | 546–799 chars |
| CI checks on descriptions | **7** |
| CI checks on tool *responses* | **0** |
| Tool-selection eval | **none** |

Published thresholds worth holding against those numbers:

- Anthropic: reach for tool search at **10+ tools** or **>10k tokens** of definitions.
- Anthropic: *"Claude's ability to pick the right tool degrades once you exceed 30–50 available
  tools."* We are at 24 and the owner intends to add more.
- Anthropic (Claude Code): tool responses capped at **25,000 tokens**.
- OpenAI: fewer than ~20 functions available at the start of a turn.

---

## The standard

### 1. Descriptions

Anthropic: *"Provide extremely detailed descriptions. This is by far the most important factor in
tool performance."* Aim for 3–4 sentences; more if complex. Every description states:

- what the tool does, and what it does **not** return;
- **when to use it** — the literal word "Use" is CI-enforced;
- when to use something else instead, naming the sibling (see `TIEBREAK_PAIRS`);
- every parameter, taught in prose with a **quoted worked example** (`{"days": 30}`), because the
  Broker reads descriptions and never sees the JSON schema;
- for actions: whether it commits or waits for a tap — CI-enforced phrase.

Length caps are a budget, not a target: **520** chars for reads, **800** for actions. They exist
because all 24 ride every request; they are not a claim that shorter is better.

**Write for a new hire, not a colleague.** Ban internal vocabulary — `occurrences` is a table,
`baseline` is a column, "Broker" is a hidden entity. The banned list is in the audit and grows
whenever a real one slips through.

### 2. Naming

`snake_case`, `verb_noun`, matching every published example (`get_weather`, `search_files`). Ours
comply, except `lookup_food`, which is deliberate — it reads a public food database, not the user's
file, and the `get_*` prefix would imply otherwise.

**Do not self-prefix.** Anthropic's docs suggest `github_list_prs`; GitHub's own server ships
`get_me`, because the *client* namespaces (`mcp__github__get_me`). Ours are a single flat set behind
one API — prefixing would be noise. Revisit only if these are ever exposed as an MCP server.

### 3. Consolidate before you disambiguate

Anthropic's test: *"If a human engineer can't definitively say which tool should be used in a given
situation, an AI agent can't be expected to do better."* Their named failure mode is bloated tool
sets with ambiguous decision points, and their prescribed fix is **consolidation, not more
disambiguating prose** — one `schedule_event` rather than `list_users` + `list_events` +
`create_event`; one tool with an `action` enum rather than `create_pr`/`review_pr`/`merge_pr`.

GitHub ships this: `issue_read` takes a `method` enum (`get`, `get_comments`, `get_sub_issues`,
`get_parent`, `get_labels`) with a numbered menu in the *parameter* description, and a one-sentence
tool description.

**Our eight hand-maintained `TIEBREAK_PAIRS` are a symptom.** Each one documents around an ambiguity
that consolidation would delete. When adding a tool, the first question is not "how do I describe
this so she picks it correctly" but "should this be a parameter on a tool that already exists".

### 4. Parameters

Prose on every parameter; name them so the type is obvious (`user_id`, not `user`); enums wherever
the value space is closed; state the default or what omission does (CI-enforced).

**Poka-yoke over documentation.** Anthropic's SWE-bench case: the model kept mishandling relative
paths, so they changed the tool to require absolute paths and *"the model used this method
flawlessly"*. Change the argument so the mistake is unrepresentable rather than warning against it.

### 5. Responses

The most under-governed surface we have, and the one that cost us a live bug (below).

- **An error must never look like an empty result.** MCP spec: report errors in the result so
  *"the LLM ... [can] see that an error occurred and self-correct"*, not as a protocol failure and
  never as silence.
- Write for the model to quote and reason over: real names over identifiers. Anthropic reports that
  resolving opaque UUIDs to meaningful names measurably improves precision.
- Omit empty sections. `null`, `[]`, `{}` and placeholder noise are pure cost.
- **Result-specific** next-step hints belong in the response ("say in one line what you have put up;
  do not claim it is done"). **Durable routing rules belong in the description.** Sentry's line:
  result text *"should not act like a system prompt"* — which is also the injection-safe split.
- Budget the size. Paginate, truncate, or take a `response_format` enum.

### 6. Errors

Actionable and specific, naming the recovery. Sentry's pattern: *"Organization slug is required.
Use find_organizations() to list."* Not an opaque code, not a traceback.

### 7. Never let a model's near-miss kill the turn

Models guess plausible-but-wrong tool names. Normalize before matching (case, punctuation), and if a
call still cannot be resolved, **answer it with an error the model can act on** — never drop it
silently. Dropping it is worse than failing: the turn ends with the model believing it is mid-thought.

---

## What CI enforces today (`description-audit.test.ts`)

1. No internal jargon, in descriptions or parameter descriptions.
2. Every tool says when to Use it.
3. Every declared parameter is taught in the description with a quoted example.
4. Every optional parameter states its default, its omission behaviour, or its condition.
5. Every confusable pair carries the tiebreak on at least one side.
6. Reads ≤ 520 chars, actions ≤ 800 chars.
7. Every action states its safety gate ("does NOT change anything" / "takes effect immediately").

This is more mechanical enforcement than any reference implementation we looked at. Sentry has a
written convention; the `claw-code` harness asserts only that a description is non-empty.

## Not yet enforced — the backlog, in priority order

1. **A tool-selection eval.** We have a static audit and plumbing probes; nothing asks *"given this
   turn, did she call the right tool?"* Anthropic's `skill-creator` and OpenAI's `eval-skills` both
   converge on the same design: a golden set mixing **should-trigger** and **should-not-trigger**
   prompts, scored as precision/recall on selection. Both report it catches exactly what we hit on
   2026-08-16 — she described `propose_plan_change` instead of calling it. Scale AI's MCP-Atlas finds
   63.3% of failures are cognitive rather than tool-call errors, dominated by **no-tool-use**: our
   bug is the field's most common failure, and the only thing that measures it is this eval.
   Source the cases from real failures — PLAN.md is already a catalogue of them.
2. **A response contract with CI teeth.** Length budget, jargon ban, and a required error shape.
   Descriptions have seven checks; responses have none, which is how a render could throw for weeks
   and read as "nothing on file".
3. **The mutation contract as a typed field, not a regex on prose.** Today the audit greps for a
   phrase. A `mutates: 'none' | 'proposes' | 'immediate'` on the tool spec, with the sentence
   *generated* from it, cannot drift and cannot be forgotten. Sentry requires the equivalent MCP
   hints explicitly because *"an absent hint is a silent gap"*.
4. **Consolidation pass over the 18 reads.** Against the 30–50 degradation threshold and the
   intent to add more.
5. **Progressive disclosure.** Anthropic's server-side tool search reports 49%→74% (Opus 4) and
   79.5%→88.1% (Opus 4.5) with ~85% fewer definition tokens. **We cannot use it**: we run through
   AI Admin → Devs.ai v2, not the Anthropic API. Ours would have to be built — and we already have
   the seed, in the Broker's `context_select` pass that picks retrieval functions per turn.
6. **Structured input examples.** Anthropic's `input_examples` field reports 72%→90% on complex
   parameter handling; OpenAI warns prose examples can hurt reasoning models. We inline examples in
   prose (rule 3 above) because the field is not available through our provider. Worth revisiting.
7. **Negative assertions in tests.** Assert what a tool set does *not* contain, so a later refactor
   cannot silently widen a capability boundary.

## Model

The coach profile is configured primary `anthropic-claude-4-5-sonnet`, failover `claude-sonnet-5` —
**the newer model is the fallback**. Live values are set by `set-coach-v2.ts` and may differ from
config; confirm before changing. Relevant here because newer models reach for tools more
conservatively, which makes prescriptive "call this when…" phrasing (rule 1) load-bearing rather
than stylistic.

## Prompt caching

Tool definitions render **first** in the prefix (`tools` → `system` → `messages`), so they are the
most cache-sensitive bytes in the request: changing any definition invalidates the entire cache.
Ours are built from a hand-ordered constant, so the order is deterministic — keep it that way. MCP's
2026-07-28 revision now says servers SHOULD return tools in deterministic order for exactly this
reason.

---

## The bug this standard is written around

On 2026-08-16, `get_workout_history` and `get_health_history` both returned
`"(nothing on file for this yet)"` for a user with thirty recorded workouts. A row type declared a
timestamp `string`, postgres returned a `Date`, `.slice()` threw, and the tool path swallowed the
throw as an empty result. The coach told the user he had no runs.

Three of the rules above would each have caught it independently: an error may not look like an
empty result (§5), responses need CI teeth (backlog 2), and a test that only feeds the *declared*
type proves the declaration is self-consistent with itself and nothing else.
