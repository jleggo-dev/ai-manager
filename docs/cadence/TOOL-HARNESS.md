# The coach's tool harness — the standard, and how we measure against it

The rules for `ai_harness_tools` — what the model calls. (`user_action_widgets`, what she *presents*,
are a different surface with their own catalog: `renderCoachToolCatalog`.)

Written 2026-08-16 after an audit against published guidance from Anthropic, OpenAI, the MCP spec
(revision `2026-07-28`), and the shipped GitHub and Sentry MCP servers. **Read this before adding a
tool.** Every rule below is either enforced in CI (`description-audit.test.ts`) or listed under
"Not yet enforced" — and the second list is the backlog, not a set of suggestions.

---

## Adding a tool: the checklist

Work through this in order. Steps 3–6 are enforced in CI, so a mistake there fails the build rather
than reaching a user; steps 1, 2 and 7 are judgement and nobody but you will catch them.

### 1. Decide whether it should be a tool at all

**Does the dossier already carry this fact?** Identity, goals, the plan, constraints, consistency,
weight, dietary profile, recent activity are all injected as text on every turn by the context pack
(`context-pack.ts`) and the turn floor (`turn-context.ts`). If your fact is one of those, or belongs
beside them, **add it to the pack, not to the tool list.** A tool for something she is already
holding is a second path to the same answer and one more decision on a turn that needed none.

### 2. Decide the layer, and file it

One question decides it: **does calling it change the user's data?**

| | | |
|---|---|---|
| **Changes data, and they'd do it most days** | Always-on action | `ALWAYS_ACTIONS` in `coach-tool-tiers.ts` |
| **Changes data, weekly or rarer** | On-demand action | goes in a category below |
| **Only reads, and it's long-tail** | On-demand read | goes in a category below |
| **Only reads, and it's dossier** | Not a tool — see step 1 | |

Adding to **`ALWAYS_ACTIONS` costs ~190 tokens on every message, forever.** That is the expensive
choice and it needs a reason in the comment. Everything else costs nothing until she asks for it, so
**reads and rare actions are free to add** — that is the whole point of the tiering.

**Then file it in a category** (`TOOL_CATEGORIES`): training, body, food, writing, changes. She
reaches the tail by drilling into a category, so a tool in none is a tool she has to guess the name
of. A CI test fails if you skip this. If it genuinely fits nowhere, add a category — and the
capability manifest names it automatically.

### 3. Write the description (CI-enforced)

- **3–4 sentences.** Anthropic: *"by far the most important factor in tool performance."*
- Say **when to Use it** — the literal word, and say when to use something else instead.
- **Teach every parameter in the prose**, with a quoted worked example: `{"days": 30}`. The Broker
  never sees your JSON schema.
- Every optional parameter says its **default**, or what omitting it does.
- An action states its **gate**: "takes effect immediately", or "does NOT change anything".
- **No internal words.** `occurrences` is a table. `baseline` is a column. The banned list grows
  every time a real one slips through.
- ≤ **520** characters for a read, ≤ **800** for an action.

### 4. Write what it hands back (CI-enforced)

Use the helpers in `tool-response.ts` — `toolFaultText`, `toolEmptyText`, `boundToolResponse` — and
the gate comes for free. `tool-response.test.ts` holds them:

- **An error must never look like an empty result.** "Nothing on file" when a query threw is a lie
  in her voice, and it took four device rounds to find the last one. The two texts are asserted to
  share no wording, so a model skimming cannot confuse them.
- **Bounded, and it SAYS when it was cut.** A silent truncation is a quiet lie about completeness.
  The cut lands on a line boundary so a row is never half-shown and misread as data.
- **Tell her what to do next**, scoped to this result — not durable routing rules, which belong in
  the description.

### 5. Make it complete in one call

**A tool's return text must never claim an effect the tool did not itself produce.** If it says
"the user now has a card", calling it must be enough to make that true. This is the cheapest rule
here to check and the one that has cost the most.

### 6. Check it is reachable (CI-enforced)

Declared and executable must be the same set. A tool the model can name but the harness drops ends
her turn mid-thought with nobody told.

### 7. Add eval cases, at least two

One where it **should** fire and one where it **must not** — a set of only positive cases measures
recall and silently ignores false triggering. Cases live in `eval-tool-selection-cases.ts` and each
cites the real incident it came from.

### 8. Run the gates

```bash
npm run typecheck && npm run format:check && npx vitest run --root apps/cadence-api
```

And if you touched the always-on list, run the eval — it is the only thing that can tell you whether
tool choice actually got better or worse:

```bash
npm run eval:tools
```

**Write the numbers down here when you do.** The 2026-08-26 run (adding `open_week_review`,
claude-sonnet-5, 36 cases) discovered the hard way that no baseline had ever been recorded, which
makes "better or worse" unanswerable without a second 45-minute, ~700K-token run on the prior
commit. Baseline as of that run — diff the NEXT run against this line instead of re-running the
old commit:

| date | change | precision | recall | F1 | clean | false-fires | under-calls | tokens/turn |
|---|---|---|---|---|---|---|---|---|
| 2026-08-26 | (deployed main) | 70.4% | 76.0% | 73.1% | 24/36 | 0/11 | 6/25 (A7 A13 A14 A15 A16 B3) | 20,654 median |
| 2026-08-27 | (deployed main, identical code) | 70.0% | 84.0% | 76.4% | 24/36 | 2/11 (C6 C8) | 4/25 (A13 A14 A15 B6) | 20,703 median |

**Two things those rows taught, the second the hard way:**

1. **`eval:tools` measures the DEPLOYED api** (the run header prints the vercel URL) — it has to,
   because coach chat only streams there. A tool-list change on a branch is therefore evaluated
   only AFTER it ships; running the eval pre-merge measures main, whatever your worktree holds.
   The check-in rebuild's two additions (`open_week_review`, `build_next_week`) still owe their
   real post-deploy run — diff it against the band below, and re-run C6/C8-style spot checks
   (`npm run eval:tools -- --only <ids>`) before reading any single-case blip as a regression.
2. **The same-code variance band**: the two rows above are IDENTICAL deployed code run twice —
   ±3 F1 points, under-calls 6↔4, false-fires 0↔2 (and C6/C8 passed clean on a targeted re-run).
   A future run has to beat the band, not the point, before it means anything.

---

## Where we stand, measured

| | Ours today |
|---|---|
| Tools exposed every turn | **24** (18 reads + 6 actions) |
| Tool definitions per request | **~5,000 tokens**, serialized 18,380 chars |
| Read descriptions | 134–438 chars |
| Action descriptions | 546–799 chars |
| CI checks on descriptions | **7** |
| CI checks on tool *responses* | **4** (was 0 — added 2026-08-16) |
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

### 6. A tool must be complete in one call

**If a tool's effect depends on the model *also* doing something else, it is two tools wearing one
name — and the second one will be forgotten.**

`propose_plan_change` stored a proposal and returned *"the user now has a card showing exactly
this"*. That was only true if she ALSO emitted a `cadence-picks {"layout":"change"}` tag in her
prose, because the card was gated on the tag. On 2026-08-16 she called the tool, the proposal
landed with exactly the right content, she said "let me swap it now" — and no card appeared. Four
turns of the owner asking her to change his plan while she agreed and nothing happened. Owner:
*"There don't need to be 2 tools for this — one tool changes the plan and also presents the results
back to the user."* Correct.

The rule that falls out:

- **State-backed UI follows the state, never a tag.** If a tool wrote something durable, the client
  reads that store and renders from it. `ChangeCard` asks the server what is pending and draws
  nothing when the answer is nothing, so it is safe to mount unconditionally.
- **A tag is only ever acceptable for a pure offer** — quick picks, a confirm prompt — where
  nothing was stored and the model genuinely is choosing to present a choice.
- **A tool's return text must not claim an effect the tool did not itself produce.** If the output
  says "the user now has a card", calling the tool must be sufficient to make that sentence true.

Audit every new tool against the last line. It is the cheapest of these rules to check and it was
the one that cost the most.

### 7. Errors

Actionable and specific, naming the recovery. Sentry's pattern: *"Organization slug is required.
Use find_organizations() to list."* Not an opaque code, not a traceback.

### 8. Never let a model's near-miss kill the turn

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
