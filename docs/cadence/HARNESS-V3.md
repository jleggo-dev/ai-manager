# Harness v3 — the coach's context over time, what she owes the user, and the checks around her

**Status: P1 (#431), P2 (#433), P3 (#435), the fold fix (#437), P7 (#439), P6 (#440), P5 (#442) and P8 shipped; P9 (#441) in review; P1b/P3b (the audit fixes) in flight.** Written 2026-10-31. R1 ruled the same
day (compact around 75K billed) and checked by P3 the same day: the threshold holds, the fold does not
(see C5.4).
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
  are kept like instruction rows. In the stored history they sit just before the summary; on the
  wire the summary goes first, inside `instructions` (P1b, H below). This closes MP33.
- Do it only at compaction time, never per turn. Removing a row from the middle of the history
  changes the cached prefix, and the cache covers ~2/3 of every message
  (memory: prompt cache is global). Compaction already breaks the cache once; doing the dropping
  at the same moment costs nothing extra.

**Tests.** The summarizer input contains no `<context`/`<note` text. Pinned blocks survive two
compactions. A config-pinning test asserts the manifest is present after compaction (this is the MP33
regression).

**Built (P1b, 2026-10-31): compaction hardening.** An independent audit of P1 and P2 found one
blocker and several should-fixes. Each fix landed with the test that would have caught it, on rows
the size production stores (`backend/test/helpers/compaction-sim.ts`: user 87/181 chars avg/p90,
reply 446/893, injected ≈3.1k/12.5k per turn, persona ~20k, once-per-session blocks ~12.5k).

- **A. The variable cap lost most of a round (the blocker).** `interpolateTemplate` keeps the first
  10,000 characters of a job variable, and the mark still moved past the whole round. At production
  sizes a round is ~27 exchanges (~15k chars of dialogue), so ~10 exchanges a round were neither
  summarized nor ever sent again. Now the transcript is built row by row up to
  `TRANSCRIPT_BUDGET_CHARS` (`MAX_VARIABLE_LENGTH` − 100, exported from `job-execution-utils.ts`;
  the cap is measured before the `<user_input>` wrapper is added, so the 100 is only a margin). The
  mark moves to the last row included, and a cut round ends on her reply. Rows that did not fit
  stay after the mark. One row longer than the whole budget is shortened and says so, so it cannot
  block every round after it. After a reply, one run does up to 3 rounds, so a backlog catches up;
  the pre-send ceiling path does one.
- **B. Folding on every message.** With 12.5k-char injected rows, a 20-turn tail is itself at the
  trigger: 50 folds in 60 exchanges, two rows each, and every fold loses something (P3). Now
  `keepTailUnits` sizes the tail over every row in it, as whole exchanges, never fewer than two
  (`keepLastNTurns` stays as the fallback for sessions that lack it), and `minRemovedUnits` skips,
  and logs, a fold that would take out less. A round the budget filled always runs, and the minimum
  is capped at half the trigger. The coach's values are 12,000 and 4,000; the arithmetic is in
  `coach-compaction-policy.ts`. Same scenario: 8 folds on the live policy (25 with the guard on
  the old tail). The guard can only delay a fold, never stop one: everything that ages out of the
  tail adds to what the next fold would remove. A send can go past the ceiling while it waits (by
  at most about one exchange in the tests); in normal use the after-reply run clears the guard
  first, because 4,000 is under ceiling − trigger (8,000).
- **C. Rows written once in a while were dropped for good:** the daily `date` stamp (date, weather,
  check-in due), the last `attachments` note (its `photo_ref`) and a mid-session `health-digest`.
  New engine rule `keepNewestRowPattern`, a regex with one capture group naming the source: of the
  rows behind the mark, the newest of each source is sent again after the summary, unless the tail
  already has one. Chosen over putting the date line in the per-turn floor, which would not cover
  attachments or digests. Limit: only the newest attachment note survives; an older photo's ref is
  gone unless the summary carries it, and the summarizer never reads injected rows.
- **D. Work after the reply could be frozen.** The route awaited capture and compaction after
  `res.end()`; both now go through `runInBackground` (`waitUntil`). Evidence: in the 19 days before
  this the coach had one real turn (2026-10-29), and neither its capture nor its `coach` ai_log row
  (also written after `res.end()`) landed. Over the 60 days before, capture ran on 93 of 121 coach
  turns. So "0 captures in 19 days" was mostly no chat; the one turn fits a freeze but proves
  nothing alone. Still after `res.end()` and not moved here: `notifyIfTheyLeft`, `recordCoachTurn`.
- **E. The mark could move backwards** when two runs overlapped. The write is compare-and-set on the
  mark the plan was built from (`updateChatSessionIfMarkUnchanged`); a miss is skipped and logged.
- **F. The summarizer's diagnostic row** now carries `chat_session_id` and `metadata.compaction`
  (rows summarized, injected rows dropped, transcript chars, whether the budget cut the round,
  units removed). `executeJob` takes an optional `diagnostics: { chatSessionId, metadata }`.
  Failures before the run log the session id.
- **G. The policy reaches open sessions.** It is copied onto a session at open, and an active user's
  session is never reopened. `npm run backfill:session-summarizer` (dry by default, `--write`
  applies, `--days 30`) sets it on every coach session that has a summarizer or was active in the
  window. Dry run 2026-10-31: 461 to write (458 at trigger 20,000, 3 at 32,000), 0 already live.
- **H. Order on the wire.** The design above said pinned rows sit before the summary. In the stored
  history they do. On the wire they don't: the Responses dialect (`buildResponsesRequest`, used by
  Devs.ai v2 and the gateway) lifts every system row into `instructions`, so the summary rides with
  the persona, ahead of the pinned rows, which are the first input items. Kept: the summary carrying
  system weight is fine. The ordering test now pins both orders.
- **I. Reading the session.** `listChatMessages` asked for every row in one request, and Supabase
  returns at most 1,000 and says nothing; in ascending order the rows lost are the newest. It now
  reads a page at a time (largest session today: 304 rows). **Follow-up, not done:** read only what
  can be sent (system rows, pinned rows, the newest row per kept source, rows after the mark). Not
  cheap now: the kept-source rows come from behind the mark, and both patterns are JS regexes that
  would have to be rewritten for Postgres.

**Rollout:** deploy; `set-coach-persona.ts` (new sessions copy the job's policy);
`npm run backfill:session-summarizer -- --write` (sessions already open); `eval:compaction`.

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

**Built (P7, 2026-10-31) — three amendments to the design above, each from the code:**
- `source_session_id` is dropped: an action's `run(userId, params)` carries no session id, and a
  column nothing fills is a lie waiting to be read. Add it with the plumbing, if ever.
- Expiry runs on the WRITE path — `noteFollowUp` sweeps that person's items past 90 days before
  inserting — so `listOpenFollowUps` stays a read (it also filters them out meanwhile).
- She closes by an 8-character id prefix, printed in brackets on each line; a prefix that fits two
  open items closes neither. `outcome` is a column, her words for how it ended.
- Filed in a new drawer category `remembering`; no capability-manifest line (68 chars of headroom,
  the category line takes ~55). Migration `0061_follow_ups.sql`, owner go.

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

**Built (P5, 2026-10-31).** All four gaps closed in one PR; no migration, no sync.
- **Bounded.** `coach-tools.ts` passes every action and meta output, and the catch-path text,
  through `boundToolResponse`. Test: an action returning 5,000 lines arrives cut, with TRUNCATED.
- **`mutates` on every spec.** `CoachActionTool`, `MetaTool`, and `RetrievalFunction` (typed as
  `'none'` only). Actions are built with `defineAction`, which replaces a `{gate}` token in the
  description with the phrase for the mode (`tool-mutates.ts`). The regex in
  `description-audit.test.ts` is gone; in its place, for every read, action (tail and
  facade-inner included) and meta tool: a mode is declared, an action carries its own mode's
  phrase exactly once and never the other's, and no action source types the phrase by hand.
- **Three shapes.** `toolChangeText`, `toolNothingChangedText`, `toolActionFaultText`, read by
  `toolOutputShape` from the first line. Every return path of every action now goes through one
  of them; no allowlist was needed. `coach-action-contract.test.ts` walks all 21 registered
  actions (changes something / changes nothing / fault where there is one) and fails any action
  source that returns a hand-built string.
- **Negative assertion.** `repo-write-imports.test.ts`, described in TOOL-HARNESS.md backlog #7.

Differences from the design above, each from the code:
- **The phrase is generated, not the whole sentence.** Most actions continue the sentence in
  their own words ("Takes effect immediately: reflecting it back is the confirmation"), so the
  token sits where the phrase was and the text after it stays the tool's. The phrase is
  capitalized only where a sentence starts, so "This does NOT change anything…" and "…and takes
  effect immediately" survive byte for byte. Every always-on definition is identical: 22,174
  serialized chars before and after. Three tail descriptions changed: `shape_week` ("all taking
  effect immediately" → "and each takes effect immediately", 759 → 763 chars);
  `send_questionnaire` ("This writes nothing: … and nothing is on file until then" → "This does
  NOT change anything: …", 792 → 767); `offer_repertoire_review` ("This saves nothing: no item
  goes on their list until they mark it and confirm on that screen" → "This does NOT change
  anything until they mark items and confirm on that screen", 797 → 783). **The last one rewords
  a sentence the 2026-09-03 plain-words ruling produced** — the stock phrase once rather than
  twice, which is what that ruling objected to, but it is the owner's to veto. All action
  descriptions together: 14,814 → 14,779 chars. find_tools label 3,092 of 3,140 and the
  capability manifest 5,804 of 5,824: both unchanged.
- **The meta tools declare the field but are not generated.** `find_tools` is `'none'`.
  `use_tool` runs whatever she names, so it declares the most it can do, `'immediate'`, and keeps
  its own sentence, which sends her to the named tool's description. That sentence says every
  `[changes their data]` tool "takes effect immediately", which is not true of the three tail
  tools that wait for a tap, or of `rebuild`'s week scope; left as is (always-on wording), noted
  for a ruling.
- **`rebuild` is `'immediate'`** because its session scope is; its own words say the week scope
  ends in a card.
- **An action fault has its own helper.** The read fault ("could not be read … NOT an empty
  record") is the wrong sentence for a write. `toolActionFaultText` keeps the old catch-path words
  and shares the read fault's "this is a fault on our side", so both classify as a fault.
- **`toolChangeText` takes a third field, `next`**, for the result-specific instructions every
  action already carried; they follow the `changed:` and `unchanged:` lines.
- **"Before and after" where the action already knew the before** (a goal's target and date,
  the kcal target). Actions that never read the old value were not changed to read it — that would
  change what they do, not how they report.
- **`update_goal` moved to `coach-action-goal.ts`**: coach-actions.ts reached 567 of its 500 lines.

`eval:tools` is owed (three tail descriptions and every action's output changed), owner-gated.

### C5. Evals built from real failures, and run on every model change

**What exists.**
- `eval:tools`: 68 cases after P7 (66 at the last full run, 2026-09-15; the case-file header said 58
  and the runner's 33 — neither header states a number now, the runner prints it), first turns
  only, run against deployed prod, manual, no pass threshold, ~1.6M input tokens per run, ±3 F1
  between runs of the same code.
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
4. **Compaction gets its own eval** (C1/C2 cannot be judged by first-turn cases). BUILT as P3:
   `npm run eval:compaction` (`scripts/eval-compaction*.ts`). Three synthetic 80-exchange
   conversations, each planting one fact per item on `coach-compact`'s KEEP list, built into the
   rows a real session stores and compacted by the engine's own `planCompaction` under the live
   policy. Scores whether each planted fact survives into the final summary. Synthetic because no
   real conversation has reached the trigger yet, and a planted fact needs no judge. `--dry` is free.

   **First reading (2026-10-31, 3 runs, ~65K billed tokens):**
   - **R1 holds.** Compaction fired at ~75–76K billed, every ~30 exchanges, and the summarizer read
     only ~1.4K units of dialogue each time: C2 dropped ~31 injected rows per round and nothing
     injected leaked into any summary (0 leaks, 12 summaries).
   - **Retention 74% (40/54)**, but split: facts first summarized in round 2 kept **95%**; facts
     from round 1 kept **61%**. The half-marathon fixture lost the same three round-1 facts in 3 of 3
     runs (the Thursday/30-minute decision, the left-knee constraint, the failed 6am runs).
   - **The loss is in the fold, not the threshold.** Round 1's summary carried all three. Round 2,
     told to "fold any existing summary into one", dropped them and spent its 250 words repeating
     her general advice (hydration, stretching, pre-run food) that round 1 already held, and that
     she can give again. By kind: decisions 33%, constraints 67%, tried-and-failed 67%;
     corrections 100%, own words 89%, open items 89%.
   - **The fix, measured the same day (3 runs, ~48K billed, `--prompt-from-config` so nothing was
     synced first):** two lines in the `coach-compact` prompt — every fact the existing summary
     holds outranks anything new, carried forward unless corrected; and advice she gave is DROP,
     keep what THEY said, asked, decided, corrected or tried. **Retention 74% → 93%** (50/54).
     Round-1 facts 61% → 88%; round-2 100%. Constraints, corrections, own words and open items
     all 100%; decisions 33% → 78%; tried-and-failed 67% → 78%. Of the four misses, one was the
     scorer ("6 a.m." with periods — term added, which reads the run as 94%); three were real:
     one run lost the Thursday decision and the 6am runs together, one lost the Sunday batch-cook
     decision to "lunches already prepared". Pinned by `coach-compact-fold.test.ts`; live after
     sync-jobs.
   - Fixture artifact to fix before the next run: the `{n}` counters in filler ("Note 58") get
     summarized as "ratings increasing up to 58". Left as is for this comparison so both arms ran
     the same input.
   - Caveat: the filler is repetitive by construction ("repeatedly asked whether to stretch"); a
     real conversation would not hand the summarizer twelve copies of one question. The fold
     dropping already-summarized facts is not caused by that.
   - Not measured yet: whether the COACH answers the probes from a compacted history. The eval
     scores the summary; asking her is the next arm.
   - Found on the way: `interpolateTemplate` cuts every job variable at **10,000 characters**
     (`job-execution-utils.ts`, `MAX_VARIABLE_LENGTH`), so one round's `transcript` can never hand
     the summarizer more than ~2,500 units. **There is no room** (corrected by the P1b audit): the
     fixture's dialogue is shorter than real dialogue. At production sizes (user 87 chars, reply
     446, measured 2026-10-31) a round is ~27 exchanges, ~15k characters, so about a third of
     every round was cut to "... [truncated]" while the mark moved past it: neither summarized nor
     sent again. Fixed in P1b (C2, "Built (P1b)", finding A): compaction splits a round to fit.

**Built (P6, 2026-10-31): C5.1–C5.3.**
- **`npm run eval:mine`** (`scripts/mine-eval-candidates.ts`; patterns in `eval-mine-patterns.ts`,
  table-tested with near-misses). A coach turn is a `diagnostic_logs` row whose `processing_job_id`
  is the `cadence-coach-chat` job and whose `chat_session_id` is set; `calling_application` is
  `platform:cadence` on Broker jobs too, so it does not tell them apart. `llm_request.promptContent`
  is the person's message and `llm_response.rawContent` her reply. **The diagnostic row holds no
  tool calls**: those come from Cadence `ai_log` `coach_tool` rows, which name the person but not
  the conversation, so they are joined by person and time. Turns from deleted or `@cadence.test`
  accounts are skipped; they are the eval's own throwaway users (685 of 873 rows in 90 days). Writes
  a gitignored markdown file (`apps/cadence-api/eval-candidates-<date>.md`) with an empty
  "promote as:" line each; `--dry` prints counts only. First reading, 2026-10-31: 30 days held 9
  turns and no candidates (little coach traffic since mid-September); 90 days held 188 real turns
  in 20 conversations and **16 candidates: 7 promised a change with no action, 5 corrected in the
  next message, 4 over 120 s, 0 tool faults.** None reviewed or promoted yet.
- **`npm run eval:tools:smoke`**: 13 cases named, each with its reason, in
  `scripts/eval-tool-selection-smoke.ts`. `--dry` estimates ~325K prompt tokens against ~1.7M for
  all 68 (19%). `--floor <F1>` exits non-zero under it and prints the gap, on any selection;
  `--smoke` defaults the floor from `scripts/eval-tool-selection.baseline.json`: the last recorded
  full run, **82.9** (2026-09-15, TOOL-HARNESS.md), minus 5 = **77.9**. `--json` writes the result.
- **`repoint-profile.ts --verify`**: runs the smoke on the new coach primary and, on a miss (F1
  under the floor, no tool call seen, another model answered, or no result), writes back the
  pointers read before the write and exits non-zero. `--force "<reason>"` keeps the pointer through
  a miss. Every verified repoint appends a line to `config/ai-admin/repoint-log.jsonl`. Refused
  before any write: a failover-only change, a profile the coach chat does not use, no floor,
  `--force` without a reason.

**Where it differs from the design above:**
1. **`--verify` writes first, then reverts; "before" is not achievable today.** A coach chat turn
   reads the model from the profile row on every send, and neither `openChatSession` nor
   `sendChatMessage` takes a model override. `modelOverride` exists only on one-shot job execution,
   which runs no tools, so it cannot run this eval. For the ~10 minutes of the smoke run the new
   model answers every coach turn, real users included; the script says so first and prints the
   restore command, and Ctrl-C restores. Testing before the write needs an engine change (a
   per-session model override, and a way for the eval to ask the deployed API for it). Owner's call.
2. **`--verify` proves a primary only.** The coach chat has no failover path at all; only job
   execution fails over. A failover still needs a live call.
3. **The smoke leaves out cases the model on file already missed** in the last full run (A13, A16,
   A20–A23, A27–A29): a case today's model fails cannot tell a worse model from this one, and it
   would drag the smoke F1 under the full-run number it is compared with.
4. **The floor compares a smoke F1 with a full-run F1** until a smoke baseline exists. The baseline
   file has a `smokeF1` slot (null); once the owner records a smoke run on a trusted pointer, the
   floor becomes `smokeF1 − 5`. The 82.9 itself is from `claude-sonnet-5` (no longer served) on 66
   cases; the coach is on `claude-sonnet-5-5` now. The first smoke run should be recorded.
5. **Action tools' faults are not detected.** The miner reads `toolFaultText`'s wording from the
   function. Action tools fail with a separate sentence in `coach-tools.ts` that is not exported;
   it can be added once P5 gives action faults a shared text.

**R5 is still open.** The gate is built as proposed (a miss reverts), with `--force "<reason>"` as
the way through. "Report only" would be a one-line change: log the miss and keep the pointer.

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

**Built (P8).** The rule is in TOOL-HARNESS.md checklist step 4 ("Write what it hands back"), not
step 5 as written above — step 4 is where the bound and the fault/empty rules already live, and
the reading rule is the same question (what reaches her) asked earlier. CLAUDE.md's "what a tool
hands back is not gated yet" line is replaced: P5 gated it.

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
| P3 | C5.4 compaction eval — BUILT + first reading above | P1, P2 | `scripts/eval-compaction*.ts`, `coach-compaction-policy.ts` | — |
| P4 | ~~R1 threshold~~ folded into P1 by the ruling; P3 checks it | — | — | — |
| P5 | C4: bound actions, `mutates` field, `toolChangeText` — MERGED #442 | — | `coach-tools.ts`, action files, audit test | — |
| P6 | C5.1–3: mine script, smoke subset, `--verify` on repoint — MERGED #440 | — | `scripts/` | — |
| P7 | C3: follow-ups store, two tools, pack section — MERGED #439, 0061 applied | — | `repos/follow-ups.ts`, `retrieval/follow-ups-function.ts`, `coach-action-follow-ups.ts`, tiers/pack/actions wiring | Cadence migration 0061 (owner go) |
| P8 | C6: TOOL-HARNESS rule (doc) — DONE (checklist step 4); food-check continues on its own plan | — | docs | — |
| P9 | C7: `fact-review` job, hooked to check-in close | P7 | new job + service | `sync-jobs` |

P1, P5, P6 and P7 touch disjoint files and can run in parallel. P2→P3→P4 and P7→P9 are chains.

`eval:tools` must be run after P5 (descriptions change) and P7 (two new tools). That run is owner-gated
as today.

## Owner rulings owed

- **R1. Compaction threshold.** RULED 2026-10-31: around 75K billed (42k units trigger, 50k units
  ceiling). P3 checked it the same day: the threshold is not where facts are lost (C5.4).
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
