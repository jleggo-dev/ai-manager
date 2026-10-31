# Harness v3 — the coach's context over time, what she owes the user, and the checks around her

**Status: SPEC; P1 shipped (#431), P2 in review.** Written 2026-10-31. R1 ruled the same day
(compact around 75K billed).
Companions: [TOOL-HARNESS.md](TOOL-HARNESS.md) (the rules for tools),
[HARNESS-V2.md](HARNESS-V2.md) (progressive disclosure),
[MEMORY-ARCHITECTURE.md](MEMORY-ARCHITECTURE.md) (the context pack). This doc does not repeat them.

It covers seven changes, each borrowed from how agent harnesses are built and each checked here
against the code and the production data as of 2026-10-31. Several of them turned out to be partly
built already; those sections say exactly what exists and only design the remainder.

---

## Why now

The owner asked whether the coach chat needs compaction. It already has compaction. What it lacks:
the compaction it has **runs on every message once it starts, holds up her reply while it runs,
and mostly summarizes our own injected context rather than the conversation.** It has fired in one
session out of 461, so none of this has hurt anyone yet. It will start to as conversations get
longer, which is exactly what a coach that remembers you is meant to produce.

The other six changes come from the same question asked of the whole harness: what do
well-built agent harnesses do that the coach's does not?

## Where we are, measured (AI Admin DB, 2026-10-31)

| Fact | Value | Source |
|---|---|---|
| Coach sessions with a summarizer configured | 461 | `chat_sessions.config.summarizer` |
| Sessions that have ever compacted | **1** | `session_summary is not null` |
| `coach-compact` runs, last 90 days | **3, all in one session, within 8 minutes** (2026-08-31 10:07–10:15) | `diagnostic_logs` |
| Coach turns, last 90 days | 873, average 23.7 s, max 493 s | `diagnostic_logs` |
| Average `coach-compact` run | 6.2 s, added to the turn it fired on | `diagnostic_logs` |
| Persona (stored `system` row) | ~5,160 units (≈20k chars) | median over sessions |
| Largest stored conversation | 16,434 units, 53 messages | `chat_messages` |
| Share of stored `user` text that is real user typing | **~5–10%** — the rest is `<context>` and `<note>` rows | the one compacted session: user messages of 11–369 chars, each beside ~3,100 chars of `<context>` |

"Units" are `estimateSessionTokens` units (chars/4). Billed tokens run ~1.78× that
(`set-coach-persona.ts:52`). Tool definitions (~5k tokens) are not in the stored history and are
not counted in either.

---

## Is 20k too low? What the field does

**Short answer: the number is defensible; what it measures is wrong.**

- **What other harnesses do.** The Anthropic API's server-side compaction defaults to a **150K-token**
  trigger on a 1M window. Claude Code compacts near the window limit. Both serve long agent tasks,
  where nearly every token in context is the task.
- **Why the coach should not copy that.** Quality falls off well before the window is full (the
  field calls it context rot). We measured it ourselves: she stopped calling tools at
  ~119k (`set-coach-persona.ts` header, 2026-08-20). The owner ruled for quality over cost. A
  chat that compacts around 36k billed and settles in a 15–40k band is conservative but
  reasonable.
- **What is actually wrong.** Three things make the trigger mean something other than intended:
  1. **The persona counts toward it.** About 5,200 of the 20,000 units are her instructions, which
     are never compacted. The real budget for conversation is ~15k units.
  2. **Most of what counts is our own injected context.** Every turn stores a `<context
     source="turn-context">` row (~700–800 units), plus a date stamp, notes and block refreshes.
     Those rows are re-sent in full by design (`turn-context-memory.ts`) and the newest copy is the
     one that matters. They are why 20k units is roughly 20 exchanges, not 100.
  3. **It never resets.** See C1.

**Ruled (owner, 2026-10-31): compact around 75K.** Shipped in P1 as `triggerTokens: 42_000` units over
the history actually sent (≈75K billed), run after the reply, with a `ceilingTokens: 50_000`
(≈89K billed) pre-send safety net. Both stay under the ~119k failure point. The P3 eval checks the
ruling rather than setting it.

---

## The seven changes

Each section: what exists, what is wrong or missing, the design, how it is tested, rollout.

### C1. Compaction: count the right thing, run once, run after the reply

**What exists.** `backend/src/services/session-compaction.ts` (engine) and
`apps/cadence-api/scripts/set-coach-persona.ts:64` (policy:
`{ jobSlug: 'coach-compact', triggerTokens: 20_000, keepLastNTurns: 20 }`). Called from
`chat-messaging.ts` before the reply stream opens, stateless sessions only.

**Defects found while writing this doc.**

1. **It re-compacts on every message after the first time.** `maybeCompactSession` measures
   `listChatMessages(session.id)`, meaning every stored row. Rows are never deleted, so once a session
   crosses the trigger it stays over it forever. Each later message re-summarizes
   *all* older conversation (`conversation.slice(0, length - keepN)`, which grows) plus the
   existing summary. Production shows exactly this: three runs in three sends over eight minutes.
   The summarizer's input grows without limit, and so does its bill.
2. **It holds up the reply.** It is awaited before `openChatSendStream`, adding ~6 s to a turn
   that already averages 24 s.
3. **`keepLastNTurns: 20` counts injected rows.** With ~3 app rows per real exchange, "ten
   exchanges kept word for word" is closer to four.

**Design.**

- **Measure what will be sent.** The trigger compares against
  `estimateSessionTokens(buildCompactedHistory(...))` minus instruction rows, i.e. the dialogue
  actually going to the model, not the whole archive.
- **Summarize only what is new.** Store `summary_through_at` (created_at of the last summarized row) beside
  `session_summary`. A re-compaction folds in only the rows between that mark and the kept tail,
  plus the existing summary. The prompt already says "fold any existing summary into one", so it
  needs no change.
- **Run after the reply.** Move the call to after `recordAssistantMessage`: fire-and-forget, with
  failure logged and swallowed (the turn is already delivered). The next turn reads the new
  summary. If a request is about to go over the hard ceiling (R1) while a compaction is still pending,
  that one request compacts synchronously. This is the only blocking path, and it should be rare.
- **Count dialogue for `keepLastNTurns`.** Count only `isRealTurn` rows, and keep the app rows
  that sit between them.

**Where it lives.** The engine is AI Admin's, so it stays generic: "instruction rows" and
"dialogue rows" need a predicate the app supplies. Proposed: an optional
`config.summarizer.appRowPattern` (a regex string; Cadence passes
`^\s*<(context|open|note)\b`, the same pattern as `coach-turns.ts:24`, exported from
`@cadence/shared` once and never hand-copied).

**Tests (the bug-fix rule: each defect ships with the test that would have caught it).**
- A session one message over the trigger compacts once; the next three messages do not.
- The summarizer input on a second compaction contains only the new rows and the old summary.
- A turn's reply is not delayed by compaction (mock summarizer sleeping 5 s; reply resolves first).
- `keepLastNTurns: 4` with interleaved `<context>` rows keeps four real messages.
- The ceiling path: a history over the hard ceiling compacts before sending.

**Rollout.** Backend change, then `set-coach-persona.ts` re-run. Policy is copied onto the session at
open, so it reaches new sessions only; existing sessions keep the old policy until they go stale
(7 days). That is acceptable, and the doc says so rather than migrating rows.

### C2. Drop old injected context at compaction instead of summarizing it

This is the coach's version of what the Anthropic API calls *context editing*: clearing stale tool
results rather than summarizing them.

**What exists.** Tool results are **not** stored. They live for one turn
(`coach-tool-loop.ts`, `submitV2ToolOutputs`); only her final prose is saved. So
"clear old tool results" has nothing to clear. The thing that piles up instead is the per-turn
`<context>` rows, the daily date stamp, `<note>` nudges and capability-block refreshes.

**What is wrong.** At compaction those rows count as conversation. They get fed to the
summarizer as if the user had said them, use up kept-tail slots, and can take the capability
manifest and pick protocol with them. That last problem is already logged and unfixed as
MP33 (HARNESS-V2.md:253-265).

**Design.**
- At compaction, app rows before the kept tail are **dropped, not summarized**. Everything in them
  is in the store and is re-sent: the floor reads on every turn, the pack at session open.
- **Exception: blocks that are sent once.** The session-open dossier (`registry-pack`) and the
  capability manifest and pick protocol (`coach-block-refresh.ts`) arrive once per session. They
  are matched by their `source` (`PINNED_CONTEXT` in `coach-turns.ts`, handed to the engine as
  `pinnedRowPattern`), with no change to the tag, which the refresher compares exactly. Pinned rows
  are kept like instruction rows, placed just before the summary. This closes MP33.
- Do it only at compaction time, never per turn. Removing a row from the middle of the history
  changes the cached prefix, and the cache covers ~2/3 of every message
  (memory: prompt cache is global). Compaction already breaks the cache once; doing the dropping
  at the same moment costs nothing extra.

**Tests.** The summarizer input contains no `<context`/`<note` text. Pinned blocks survive two
compactions. A config-pinning test asserts the manifest is present after compaction (this is the MP33
regression).

### C3. Follow-ups that outlive the conversation

**The principle.** Long-running agent harnesses end a session by writing a short progress note:
what was done, what is open, what comes next. The next session reads it first instead of
rediscovering it. For the coach, "what is open" is the brand promise: *never makes you repeat
yourself*.

**What exists.**
- The `coach-compact` prompt already keeps "anything still open: an unanswered question she asked,
  or a change discussed but never applied". But that lives in one session's summary and dies
  when the session goes stale.
- `planGapNote` / `targetlessGoalNote` (`coach-context.ts`) carry two specific open items
  deterministically.
- MEMORY-ARCHITECTURE.md §4.4 lists an `open_threads` section in the pack. **It was never built.**
- Capture writes facts only (name, goals, equipment, constraints, baseline, timezone, location).

**Design: the coach writes her own follow-ups, through a tool.** Not the Broker. The governing
inversion is that she is in control and the software is her tool, and the person who promised
to check on the knee is her.

- **Store:** `cadence.follow_ups` (`id, user_id, text, due_on null, source_session_id,
  created_at, closed_at null, closed_by 'coach'|'user'|'expired'`). One migration.
- **Tools** (drawer tier, not `ALWAYS_ACTIONS`, per the drawer ruling):
  - `note_follow_up {text, due_on?}`. Description: use when you tell the person you will come back
    to something, or they ask you to.
  - `close_follow_up {id, outcome}`.
- **Reading it is not a tool.** Open follow-ups are a fact she needs on every turn without asking, so they go in the
  context pack and the per-turn floor as one plain section: `== THINGS YOU SAID YOU'D COME BACK TO ==`,
  newest first, capped at 8, with due dates. This passes checklist step 1 ("does the dossier already
  carry this fact"): it is dossier, not tool.
- **Expiry is shown, not done silently.** An item past 30 days is shown with its age. It closes only when she
  or the user closes it, or after 90 days (`closed_by 'expired'`).
- **What she does with them is hers.** Facts, not picks: the section lists them. It never says
  "raise these now".
- **UI.** None in v1. If the owner wants it later, Settings → "What the coach is keeping track of",
  each with a close button. Owner ruling R3.

**Tests.** A table test for the section render (empty, one, eight-plus, overdue). Tool description
audit (CI). Two `eval:tools` cases: should-fire ("remind me to ask about the race entry Friday"),
should-not ("I'll think about it"). An `eval:outcomes` scenario: promise in session A, session goes
stale, session B opens, and the follow-up is in the pack.

### C4. What tools hand back: finish the contract

**What exists, and better than the last answer assumed.** `tool-response.ts` +
`tool-response.test.ts` already enforce that a fault and an empty result share no wording, that a
render that throws arrives as a fault, and that every read is cut at 7,400 chars with a TRUNCATED
notice.

**Gaps.**
1. **Action outputs are not bounded** (`coach-tools.ts:360`, `actionOutputs` passed through).
2. **The mutation contract is a regex on prose** ("takes effect immediately" / "does NOT change
   anything"). This is TOOL-HARNESS backlog #3.
3. **Actions do not have to say what changed.** A tool that mutates should return the before and
   after of what it touched, so her confirmation to the user is read from facts, not inferred.

**Design.**
- Route `actionOutputs` through `boundToolResponse`.
- Add `mutates: 'none' | 'proposes' | 'immediate'` to every tool spec. **Generate** the safety
  sentence in the description from it, and delete the regex check.
- For `mutates !== 'none'`: return through a shared `toolChangeText({ changed: [...], unchanged?:
  [...] })` helper. A test walks every action with a fixture and asserts that the output has a
  `changed:` line, or a fault, or an explicit `nothing changed: <reason>`.
- Negative assertions (backlog #7): a test asserting that the `'none'` tools never import a repo write
  function.

### C5. Evals built from real failures, and run on every model change

**What exists.**
- `eval:tools`: 64 cases (header says 33, doc says 66; fix both), first turns only, run against
  deployed prod, manual, no pass threshold, ~1.6M input tokens per run, ±3 F1 between runs of the
  same code.
- `eval:outcomes`: 11 multi-turn scenarios asserting database state.
- `eval-conversation-replay.ts`: one conversation.
- `diagnostic_logs` already stores `llm_request`, `llm_response` and `chat_session_id` for every
  coach turn (873 in 90 days). **The raw material for mining cases is already captured.**
- Repoint scripts (`repoint-profile.ts`, `set-coach-v2.ts`) run no eval.

**Design.**
1. **Mine candidates, keep the human in the loop.** `scripts/mine-eval-candidates.ts` reads
   `diagnostic_logs` for the coach job and flags turns matching known failure shapes:
   - prose that promises a change ("I've updated", "I'll move") with no action call that turn;
   - a tool output starting with the fault text;
   - the user correcting her ("no,", "that's not", "I said") in the next message;
   - turns over 120 s.
   It writes a markdown review file. **Nothing becomes a case automatically.** The owner or an
   agent promotes a candidate into `eval-tool-selection-cases.ts` with its incident citation, which
   is the shape the cases already use.
2. **A smaller, gating subset.** `eval:tools:smoke`: ~12 cases chosen for the widest spread, about 1/5 of the
   cost, with a floor (proposed: F1 ≥ the last full run minus 5, which allows for the ±3 noise).
3. **Run on repoint.** `repoint-profile.ts` gets `--verify`, which runs `eval:tools:smoke` against
   the new pointer *before* writing it. It refuses on a miss unless `--force` is given with a
   reason, which is logged. This is the code version of the catalog-is-not-callable lesson: prove a
   model with a live call, and here, prove it with her tools.
4. **Compaction gets its own eval** (C1/C2 cannot be judged by first-turn cases). Three long replayed
   conversations, compacted, then probe questions whose answers sat only in the compacted part
   ("what did I say about my knee?", "what did we agree for Thursday?"). Graded by
   whether the answer matches the transcript. This is the gate for R1.

**Cost.** Mining is read-only SQL, essentially free. Smoke ≈ 300K tokens per run. The
compaction eval ≈ 3 conversations × ~30 turns: owner-gated, like `eval:tools` is today.

### C6. Heavy reading happens outside her context

**What exists.** Reads are already bounded and compact (largest real render under 1,000 chars). The one
place raw candidates reach her is food: `check_food_sources` passes up to 6 candidates with their
disagreements. The fix is already designed and ruled: the `food-check` job and candidate book
(FOOD-LOGGING-COACH-LED.md; gateway adapter #427 merged; job not built).

**Design.** No new mechanism. Two things:
- **Finish the food-check build** as already planned. It is the same principle, and it is the next item in
  that doc.
- **Write the rule into TOOL-HARNESS.md checklist step 5.** If answering needs reading more than
  ~2k tokens of raw material, the reading happens in a separate job that returns facts in the
  tool's shape. She gets the result, never the pile. A tool that cannot meet the 7,400-char bound
  without truncating is the sign.

### C7. Stale and contradicting facts: find them, ask, never overwrite

**The principle.** Agent teams run background passes that find docs which have drifted from
the code. The coach's version: the dossier grows for months, and facts start to contradict each other
("has a gym membership" vs a June detour "gym closed").

**What exists.** Merge at write time (`constraint-merge.ts`: "Nothing is ever dropped by
silence… Removal is an explicit act, and it belongs to Settings"; `capture-goal-merge.ts`;
`sameEquipmentName`). A one-off `dedup-captured-facts.ts`. **No scheduled reconciliation.**

**Design.**
- **A weekly job, `fact-review`** (AI Admin job, gpt-class with strict schema, per the Broker model
  note). Input: one user's dossier facts with their `created_at`/source. Output:
  `[{ fact_ids, kind: 'contradiction'|'stale'|'duplicate', evidence, question }]`. Evidence is
  required, the same rule as "guards report evidence".
- **It writes nothing to the facts.** Findings go to `follow_ups` (C3) as `source: 'fact-review'`
  items, so she raises them in her own words when it fits ("You mentioned the gym closed in June:
  are you back there?"). The user's answer goes through the normal capture or Settings path.
  Safety stays as it is: allergen flags are a union, and only the user clears one.
- **Scheduling.** Triggered when the weekly check-in closes (the recap already runs then), not a
  new cron. This keeps the cron landscape ruling intact.
- **Depends on C3.** Without the follow-up store it has nowhere to put findings except a new
  surface, and a new surface would be wrong.

**Tests.** A table test with fixture dossiers: true contradiction, near-miss (two different
dumbbell pairs, which are both true), stale-by-detour, duplicate-by-spelling. The job output is
schema-validated. An assertion that the job holds no write path to fact tables.

---

## Order of work

Parcels sized for one PR each. Dependencies are explicit. Sizes respect the 500/150 lint caps.

| # | Parcel | Depends on | Touches | Migration / sync |
|---|---|---|---|---|
| P1 | C1 engine: measure sent history, incremental summary, after-reply, dialogue-only tail | — | `backend/src/services/session-compaction.ts`, `chat-messaging.ts`, `chat-history.ts` | AI Admin migration 016 `summary_through_at` on `chat_sessions` |
| P2 | C2: drop app rows at compaction, `pinned` blocks (closes MP33) | P1 | engine + `coach-block-refresh.ts`, `@cadence/shared` pattern | `set-coach-persona.ts` re-run |
| P3 | C5.4 compaction eval | P1, P2 | new script | — |
| P4 | ~~R1 threshold~~ folded into P1 by the ruling; P3 checks it | — | — | — |
| P5 | C4: bound actions, `mutates` field, `toolChangeText` | — | `coach-tools.ts`, action files, audit test | — |
| P6 | C5.1–3: mine script, smoke subset, `--verify` on repoint | — | `scripts/` | — |
| P7 | C3: follow-ups store, two tools, pack section | — | new repo/service/tool files, `context-pack.ts`, `turn-context.ts` | Cadence migration (owner go) |
| P8 | C6: TOOL-HARNESS rule (doc); food-check continues on its own plan | — | docs | — |
| P9 | C7: `fact-review` job, hooked to check-in close | P7 | new job + service | `sync-jobs` |

P1, P5, P6 and P7 touch disjoint files and can run in parallel. P2→P3→P4 and P7→P9 are chains.

`eval:tools` must be run after P5 (descriptions change) and P7 (two new tools). That run is owner-gated
as today.

## Owner rulings owed

- **R1. Compaction threshold.** RULED 2026-10-31: around 75K billed (42k units trigger, 50k units
  ceiling). P3 checks it.
- **R2. AI Admin engine change.** C1/C2 change shared engine behaviour (`appRowPattern`,
  `summary_through_at`). Other callers have no summarizer configured today, so the change is invisible
  to them, but it is AI Admin code.
- **R3. Follow-ups UI.** None in v1 (proposed), or a Settings list from day one.
- **R4. `fact-review` cadence.** Weekly at check-in close (proposed), or monthly.
- **R5. Smoke-eval floor.** Gate repoints on it (proposed), or report only.

## Not in scope

- Raising the trigger toward the API's 150K default. The measured failure point (~119k) and the
  quality ruling rule it out.
- Threading (Devs.ai v2 provider-held history). It stays parked; compaction is skipped under it
  anyway.
- Tool search / progressive disclosure. That is HARNESS-V2.
- Automatically promoting mined failures into eval cases.
