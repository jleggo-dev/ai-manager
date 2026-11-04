# Walkthrough v3: the plan

**Started:** 2026-11-02, from the owner's gym session "Obstacle strength: pull, carry…" (four
screenshots) and the conversation that followed. Living doc: tick items off here.
**Design brief (for Claude Design):** [`design/walkthrough-v3-brief.md`](design/walkthrough-v3-brief.md).
**Design canvas:** https://claude.ai/artifact/Ln6iHKGSDH2faHkQGRGRvg (17 boards, 2026-11-03).
The owner's rulings from ~25 comment rounds on it are in the session memory
`project-cadence-walkthrough-v3-design-rulings`. Treat them as settled. The ones that change a
phase are folded in below. One of them adds to 2b: past the target the ring goes **hashed**, and over and under use the same
screen and the same colour, never a warning.
First slice is PR #472 (open 2026-11-03): a button that writes is commit green, and amber means in
progress.

## What the design settled (2026-11-03) — and what it adds to the build

- **One "Change" button beside the target** opens _Change this move_. This replaces the separate
  Swap and Adjust ideas. The sheet lists:
  - **Add weight** first. It opens its own control: − / + in 2.5 lb steps, a decimal field, and
    "Jump to" chips for _my suggestion_, _last time · date_ and _None (bodyweight)_, then a
    "Use 7.5 lb" commit.
  - **Or swap for…** rows. Each shows the name and target, an equipment chip ("No tools",
    "Bench · kettlebell") and either "Last 2 × 10 · Oct 21" or **New**.
  - **Something else.** It shows "asking · ~20 s", and her pick **lands as a new row** in the
    list, so nothing waits on it.
  - "Change" also appears on circuit moves.
  - _Adds:_ a coach-suggested load per item ("my suggestion"), equipment on each alternative, and a
    **single-item** alternative call. `revise_session` regenerates the whole session, which is too
    big and slow for this, so it needs a small new AI Admin job (step 5f).
- **After a swap:** a "Swapped from glute bridge · Undo" pill above the title.
- **After adding weight:** the set chips show each set's load, the dial reads "reps · 15 lb", and
  a quiet **Change weight** button applies to the current set only. So load is per set (5a).
- **Timed sets (B):**
  - The ring is **this set's clock**, not the set count; the set chips carry the sets. The target
    reads "45 s × 40 lb · 4 sets".
  - **Past the target the clock keeps counting up** ("8 s over") until **Stop**.
  - Stop opens a review: the seconds with − / +, "8 over target · Reset to 45", then **Keep going**
    or **Log**. A set that stops early is reviewed the same way ("13 under target").
  - **Rest between sets is not drawn.** It is open (see 2b).
- **Circuit with a timed move:** a 0:18 / 30 s clock in the middle band, the cue clamped with
  "more", Change, Form and Stop, plus a "This round" list.
- **Rearrange (C):**
  - Opened from **All steps → Rearrange**, with Undo and Done.
  - Every row is a **group of sets**, and every pill is one set, in the order you'll do them.
  - Pick two groups and choose **Alternate / Sequence** (the preview updates as you toggle), then
    **Combine**. A combined group has **Split**.
  - **Spread** = drag one set pill into a gap elsewhere, which leaves that set as its own one-set
    group.
  - A combined group plays as "Circuit · Round 1 of 3 · bench + row", with turn chips (Bench R1,
    Row R1 …) and the usual reps tool for each turn.
  - Nothing is marked "moved".
- **Recap (6):**
  - "You changed 3 things": each change is listed as a fact, **with its own Every time / Just
    today** choice. The copy is fixed and no model writes it.
  - Under that are the log lines the coach reads ("Hip thrust 2×12 @ 40 lb · swapped", "Farmer
    carry 45 · 53 · 32 · 45 s").
  - R5 is now per change, not one question.
- **Long cue (7a/7b):** the cue under the title clamps at **two lines** with an inline **more**;
  more opens a bottom sheet with the whole text at reading size (16 / 1.6), the Form link and
  Change beside it. The tool never moves. Circuit moves use the same clamp in the middle band.
- **Redlines + naming:** one board with every value the screens use (colour roles, type, sizes,
  spacing, radii, shadows), the naming table against BRAND.md, and the log-line grammar
  (`2×12 @ 40 lb · swapped from glute bridge`, `45 · 53 · 32 · 45 s`, `circuit · 3 rounds`,
  `3×45 s · one at a time`). Colour has three jobs: amber = in progress, green = done / commit,
  one off-target colour for over and under alike.
- **Settled on the canvas 2026-11-03:** the timed set's **Stop** is amber (it only halts the
  clock; Log on the next screen writes), matching #472; the Recap says **Just today** everywhere.
- **Still open from design:** the typeface for the big numbers (the shipped serif vs the design
  system's Plus Jakarta Sans); the Sequence state of the toggle is described, not drawn.

## What the owner asked for (six points)

1. **Swap a move, or add weight, fast.** For example running → bike → skipping rope, or glute
   bridge + weight. Deterministic options drawn from what I've done before come first. Asking the
   coach is the slow fallback.
2. **Timed work set up as reps.** Farmer carries played as "1 rep × 4 sets". Time should be its own
   thing, with a timer.
3. **A circuit move tagged TIMER, with no timer.** It reads "30s hold — self-timed".
4. **Rearranging the session myself.** Alternate presses and rows; spread dead hangs through the
   session. Save the change and let the coach learn from it.
5. **No chime on the multi-part (interval) timer.**
6. **Cue text cut off mid-sentence.**

Then: **should something check that she set up the tools correctly?** Yes. Check, and send what
the check found back to her. Never correct it silently (see Phase 3).

## What we found (facts, with where)

- **Text is cut by the server.** `normalizeSession` keeps the first 200 characters of `detail` and
  the first 40 of `load`, mid-word, with no "…"
  (`apps/cadence-api/src/services/session-normalize.ts:28`, `:144`). Since August, 353 of 1,319
  stored steps had their cue cut, and 33 their load (for example "find a weight that feels 7 out
  of 10 (tr"). Text already stored stays cut.
- **The interval timer never unlocks sound.** `StepTimer` calls `unlockAudio()` inside the Start
  tap. `StepInterval` doesn't, so after the 3-second pre-roll its first chime plays outside a tap,
  and iOS keeps the audio suspended for the rest of the run. This is the 2026-09-06 calf-stretch
  bug again. It also books no phone alarm, so it is silent with the screen locked.
- **The circuit has no clock at all.** A timed move renders `"{n}s hold — self-timed"`
  (`tools/StepCircuit.tsx`). Each move's `detail` (the cue) is carried but never drawn.
- **A new step opens scrolled down.** The step area is one scroll container shared by every step
  (`Walkthrough.tsx`) and is never reset. Step 10 opened scrolled down from step 9, which hid the
  start of its title.
- **She has no good way to write a timed effort done in sets.** About 9 of the 1,319 steps are set
  up wrong, and every one is a carry, hang or hold done in sets:
  - reps with 1 rep per set, the time only in the cue (farmer carries Nov 1 and Aug 31, an elbow hold);
  - a timer with sets, where **the timer ignores `sets`** and plays ONE clock (dead hang 3 × 30 s and
    suitcase carry, Oct 5);
  - a timer with no time on it (Sep 6, two holds);
  - a check-off counting "3 walks" (Nov 3).

  One carry was written four different ways in four sessions (reps, check-off, timer inside a
  circuit, interval). `inferTool` lets `sets` beat `duration_min` and drops the duration
  (`packages/cadence-shared/src/walkthrough.ts:281`). More than 20 other steps mention seconds only
  to pace each rep ("pause 2 seconds at the top"). That is why a regex autocorrector is ruled out.

- **Nothing checks her session for errors.** The job's `expectedSchema` only checks that `blocks`
  is a list and `note` is text, with formatting rules `repair-json` and `require-keys`
  (`config/ai-admin/ai-admin.config.json`, `prescribe-session`).
- **Swapping has nothing to build on.**
  - No exercise catalog, and no muscle or movement tags.
  - Logs keep ONE sets/reps/load per item (`OccurrenceLogItem`), and the load logged is the
    prescribed one, not what was lifted.
  - No query answers "what have I done for exercise X". `listRecentLogsByTitle` matches by activity
    title, and only the summary plus how it felt reach the model.
  - The closest thing is `propose_plan_change` → `rework` (`activity.how_to`, which applies to every
    future session).
- **The coach never learns how sessions are structured.** Nothing records "alternate presses and
  rows". The v2 brief made straight vs circuit "the coach's choice, not a user toggle"; point 4
  reverses that.

## Rulings (owner, 2026-11-03) — all six given in one sitting

- **R1 — timed sets = `timer` + `sets`, not a new tool kind.** RULED: yes (option A). Add
  `rest_sec` and `load` to the timer step. The Oct 5 dead hang (`timer`, `sets: 3`,
  `duration_min: 0.5`) is already in this shape and starts working. The catalog is filled in when
  the session is built, so no job sync. Still open inside it, an owner choice rather than a ruling:
  whether rest between sets is drawn. Start undrawn (tap Start for the next set) and store
  `rest_sec` anyway, so a rest clock can come later without a schema change.
- **R2 — the person may change the structure (alternate / spread / reorder).** RULED: yes. This
  reverses v2's "coach's choice"; the owner's reason is that she has not been keeping fatiguing
  moves apart on her own, so the person gets the control. Two paths, both wanted: the
  deterministic Rearrange sheet (Phase 6), AND an agentic one where the person asks the coach to
  rearrange **this session**, in place, with no whole-week replan to review and accept. The
  agentic path needs a small per-session job (one session in, the same session reordered out),
  not `revise_session`; it sits beside 5f's single-item alternative call.
- **R3 — swaps are written by the coach when she builds the session.** RULED: yes, 2–3
  alternatives per strength or cardio item at build time (more output per build, prompt change →
  sync-jobs). Owner's addition: once activities are maintained and grouped (a pattern or group on
  the activity — hinge, push, pull, carry…), the alternatives list can be filled
  **deterministically** from the person's own activities in the same group, with the coach's
  picks on top. That grouping is a design input for 5f, not built yet.
- **R4 — the repair round.** RULED, reframed: a repair loop is a normal harness pattern and gets
  built the way good harnesses build it, not capped at one round as a principle. A bounded loop
  with a stop condition: each round must shrink the findings; stop when clean, when the findings
  stop shrinking, or at the cap. The cap is a tuning number (start at 3), never unbounded. On stop
  the session ships as it is and the findings are logged, so nobody gets stuck.
- **R5 — where a learned structure lives.** RULED: no schema. `activity.how_to` through the
  existing `rework`, the free text every future session already reads. Per change (Every time /
  Just today), the person confirms first.
- **R6 — the chime is heard no matter what screen you're on.** RULED: yes. (Raised by #477's
  locked-screen check; the interval chime only sounded while the player was on screen.) It
  implies three pieces, in this order: (1) keep the screen awake during an interval or timer run,
  extending the 2026-11-01 "screen on only while the metronome clicks" ruling to every running
  clock; (2) the running clock lives at app level, not inside the walkthrough screen, so leaving
  the screen or switching tab does not unmount it and the chime still plays; (3) for a phone
  locked by hand or in a pocket, local notifications for the next boundaries, inside the iOS
  64-slot budget shared with plan reminders, rebooked on every pause, skip or edit. (1) and (2)
  cover the gym floor; (3) is the pocket tier behind them.
- **No text that explains the UI** (ruled 2026-11-03 in the header parcel, extended the same day):
  every tool, not only the ones Phase 1 touched. StepMeditate's "tap anywhere" half and its
  footnote, HandsFree's "tap to control the timer by voice", and Metronome's "Tap four beats to
  set it by ear" caption go the way the timer's footnote went (#482).

## Phase 1 — bug fixes, no design needed (one PR, can start now)

- [ ] **1a. Interval chime.** Call `unlockAudio()` in every Start path (pre-roll, warm-up, resume,
      restart). Test: every Start path opens the audio inside the tap.
  - Separate question: chimes with the screen locked. Intervals book no alarm. The owner ruled the
    screen stays on only while the metronome clicks, so a locked phone can't chime between phases
    unless we book a local notification per phase. **Check what `localNotifications` can schedule
    before promising this.**
- [ ] **1b. Text cuts.**
  - `detail` 200 → 600 and `load` 40 → 80; cut on a word boundary and add "…".
  - Tell her the limits as facts in the item format.
  - SaveAsYours uses the same normalizer and gets the fix too.
  - Table test: cut at a word, never mid-word, and text under the limit untouched.
- [ ] **1c. Long cues in the app.** Show 3 lines plus "more", in the step header and on circuit
      moves (which currently draw no cue). This is an interim look; design D may restyle it.
- [ ] **1d. Scroll to top on every step change.** Test: open step 2 scrolled down, go to step 3,
      and it starts at the top.
- [ ] **1e. A real countdown for timed circuit moves.** Reuse the `StepTimer` clock with chime and
      `unlockAudio`; when it reaches 0 it moves to the next move. Interim look; design B restyles it.
      Test: a timed move shows a clock, not "self-timed".
- [ ] **1f. Header changes from the design rulings.**
  - The target is plain text with Change + Form beside it on one line; the TARGET box goes.
  - Cut the instruction lines that explain the UI ("Back and Next only move you — nothing is
    logged or lost.").
  - Owner ruling 2026-11-03: no instructional text covering for the UI.
- After merge: deploy the API, rebuild the phone, run the cleanup script. No job sync, no
  migration.

## Phase 2 — timed sets (after R1; finished look after design B)

- [x] **2a. Shared.** (PR: timed sets, 2026-11-03)
  - Timer step: add `sets?`, `rest_sec?`, `load?`. Done; `rest_sec` added to `SessionItem` and
    the API normalizer (bounded 1–600 s, `clampRestSec` in `timed-sets.ts`).
  - `inferTool`: when an item has `sets` + `duration_min` and no `reps`, it becomes timed sets, and
    the duration is no longer dropped. Done; the step's minutes are sets × one set plus the rests.
  - Table test with positives from the real rows and the near-misses: `timed-sets.test.ts`.
- [x] **2b. The player (design B).** `tools/StepTimedSets.tsx`, its own file (StepTimer.tsx is
      361 lines; the clock pieces are shared). The set chips are `tools/SetChips.tsx`, drawn once
      for reps and timed sets (done chips green, per "done is green").
  - The ring is the set's clock; the set chips carry the sets.
  - Past the target the clock counts up ("8 s over"), with a chime at the target, until Stop.
  - Stop opens a review: seconds with − / +, "N over/under target · Reset to 45", then Keep going
    or Log. It does NOT log at the target; a single hold still does.
  - Switch-sides works per set. A remembered session reopens on the same set, clock running.
  - Rest between sets is not drawn (owner: start undrawn); `rest_sec` is stored for later.
- [x] **2c. Log.** `StepLog` kind `timed_sets` (seconds per set, target, load); log line
      `4×40 s @ 2×40 lb` from `timedSetsLogLine` in shared; Recap and the all-steps row read it
      through `logLine`. `parse-session-log` reads the summary line; its normalizer already keeps
      `sets`, `duration_min` and `load` — `duration_min` on a sets item is ONE set, documented on
      `OccurrenceLogItem`. No prompt change.
- [x] **2d. Catalog wording, facts only.** The timer entry states the sets fact and lists
      `sets`, `rest_sec`, `load` under fills. Filled in code at session build, so no sync-jobs.
- [x] **2e. Watch.** Checked, nothing built. The watch plays sessions (CadenceWatch; the strength
      list comes from `watch-week.ts`, which sends `sets` and `durationSec` together), and
      `StrengthPlan.swift` already walks every set as its own step and opens a duration-without-reps
      item in `HoldView` — so a carry plays as "Set 2 of 4" then a hands-free 45-second hold, per
      set. Near parity, with three gaps left as they are: the wrist hold ends itself at the target
      (no count-up, no − / + review); `WatchExercise.spec` prints the duration only when `sets`
      is nil, so the prescription line shows the load alone; and `composeWorkoutPlan` counts one
      set's minutes for the WorkoutKit goal, not sets × one set.
- After merge: deploy the API and rebuild the phone. Then re-run the audit (Phase 3c) after a week
  of new sessions.

## Phase 3 — the checker and repair round (after R4; can run alongside Phase 2)

- [x] **3a. `checkSession()` in `@cadence/shared`** (`session-check.ts`, PR: the session checker,
      2026-11-03). It returns findings, never fixes. Each finding is `{ rule, blockIndex, itemIndex,
      item, severity: 'error' | 'question', fact }`, the fact one plain sentence for the coach. Rules,
      each with a table of positives (the stored shapes) and near-misses:
  - `timer_no_time` (error): a timer with no `duration_min`;
  - `one_rep_sets` (question): `reps` ≤ 1 with `sets` ≥ 2 — the carry; the cue's time is quoted
    when there is one;
  - `checkoff_counts` (question): a check-off with `sets` ≥ 2 or whose words count walks, sets,
    rounds, trips or carries;
  - `reps_no_sets` (question): `reps` with no `sets` outside a circuit;
  - `circuit_no_rounds` (error): a circuit block with no `rounds` (the normalizer keeps it; the
    player falls back to the largest sets count);
  - `text_cut`: text over the limit (error), or ending with the "…" the app leaves when it cuts
    (question). The limits moved to `@cadence/shared/session-limits.ts`, read by the normalizer
    and the checker.

  Two of the rules written before Phase 2 are gone: a timer with sets and no `rest_sec` is not a
  finding (rest is undrawn and optional), and sets + `duration_min` with no reps is the timed-sets
  shape, fine. Time mentioned in a reps item's cue ("pause 2 seconds at the top") is never a
  finding.

- [x] **3b. The repair loop** (`apps/cadence-api/src/services/session-repair.ts`), per R4 — a
      bounded loop, not one round. Every `prescribe-session` call goes through `generateSession`
      (first open, prefetch and `reviseSession` alike), so the loop lives there: normalize, check,
      and when there are findings call the job again with them in `<check_findings>`. Cap
      `REPAIR_ROUNDS_MAX` = 3; each round must strictly reduce the findings; stop when clean, when
      they stop shrinking, or at the cap. The session with the fewest findings ships (the latest on
      a tie); a round whose call fails or whose answer is unusable keeps the last good session.
      Every round's findings and the stop reason land in the `prescribe_session` ai_log row under
      `meta.check`.
  - Job prompt change (`check_findings` variable + one rule line) → **sync-jobs owed**.
- [x] **3c. The audit as a script** (`apps/cadence-api/scripts/audit-session-tools.ts`, read-only;
      `--since` and `--user` filters). The 2026-11-02 baseline is documented at its top. `\y`, not
      `\b`, in a Postgres regex — the script matches in TypeScript instead.
- [x] **3d. Strict output format.** Checked 2026-11-03: the coach profile is `claude-sonnet-5-5`
      on the Devs.ai v2 provider (failover `gpt-5.2`, same provider). AI Admin only enforces a
      native `json_schema` on the Vercel AI Gateway provider type; Devs.ai v2 accepts the field and
      ignores it (measured 2026-10-29, `ai-profile-runtime-options.ts`). The job's schema also
      declares `blocks` as an array of open objects, which strict mode cannot take, and the
      `fields` descriptor has no way to say "a timer needs `duration_min`" (no per-tool
      conditional). So a strict schema buys nothing on the live path today and the schema was
      left as it is; the checker is the gate. Revisit if the profile moves to the gateway.
- After merge: sync-jobs, then deploy the API.

## Phase 4 — design (Claude Design, runs alongside Phases 1–3)

- [x] Canvas done 2026-11-03 (link at the top); its decisions are under "What the design settled".
- [x] Publish the missing boards: long cue 7a/7b and Redlines + naming (published 2026-11-03; the
      canvas is complete, 17 boards).
- [x] Naming settled by the canvas: **Change** (one button, not Swap/Adjust), **Add weight**,
      **Or swap for…**, **Something else**, **Rearrange**, **Alternate / Sequence**, **Combine** /
      **Split**, **Every time / Just today**.

## Phase 5 — swap and adjust (after R3 + design A)

- [ ] **5a. Log per-set load.** Each set records `{reps|seconds, load}`, and the walkthrough log
      sends what was actually lifted. Check what `parse-session-log` and `OccurrenceLogItem` need.
      Check whether this needs a migration (the log is jsonb, so possibly not).
- [ ] **5b. A history read.** "Exercise X, last N times": dates, sets, reps, load. It feeds the
      sheet's "you've done this" rows, and the coach's `recent_logs` gets per-item lines instead of
      only the summary. Check whether the dossier already carries this (TOOL-HARNESS step 1) before
      making it a coach tool.
- [ ] **5c. `alternatives[]` on `SessionItem`**, written by `prescribe-session`. Each alternative:
      name, quantities, and the equipment it uses (drawn as a chip). **No reason line**: owner ruling,
      the rows show the name, target, equipment and history or New only. Each item also
      gets a **suggested next load** (the "my suggestion" jump). Normalized and capped. Job prompt
      change → sync-jobs.
- [ ] **5d. The Change sheet (design A).**
  - Add weight: its own control, with − / + in 2.5 lb steps (in the person's units), a decimal
    field, and jump chips for suggestion / last time / bodyweight.
  - Or swap for…: her alternatives plus history ("Last … · date", or New).
  - Something else: see 5f.
  - Swapped pill with Undo.
  - Change weight scoped to the current set.
  - On reps steps, timed sets and circuit moves.
- [ ] **5f. "Something else": a single-item alternative job.** A small new AI Admin job (auditable):
      one item plus equipment, constraints and history in, one alternative out. Target ~20 s or less.
      The result lands as a new row and never blocks the sheet. `revise_session` is too big for this,
      because it rebuilds the whole session.
- [ ] **5e. Show swaps.** A swap reads as "swapped X for Y" in All steps, the Recap and the log
      line, never as a skip. The coach sees swaps in `recent_logs`.

## Phase 6 — rearrange the session (after R2 + R5 + design C)

- [ ] **6a. A model for the played session: groups of set-turns.** The design's unit is a
      **group** (a row) of **turns** (a pill = one set of one item). Today the walkthrough is keyed by
      step id and logs once per step; a circuit logs only `roundsDone`. Rearranging needs:
  - turns keyed by (item, set index), so one step's sets can live in different groups;
  - per-turn logs (reps/seconds + load) that survive moving a set;
  - a combined group that plays as a circuit but logs each turn.

  Do this first, in shared, with table tests. Everything else in Phase 6 sits on it.

- [ ] **6a′. Rearrange mode (design C).**
  - Opened from All steps, with Undo and Done.
  - Pick groups → Alternate / Sequence (the preview updates live) → Combine; Split undoes it.
  - Drag a set pill into a gap to spread it.
  - Logs nothing, can be undone, and is remembered across a reload (`sessionInProgress` stores
    the played shape).
- [ ] **6b. The log records the structure as done** (a short diff against what she prescribed).
- [ ] **6c. "You changed N things" at the Recap (design 6).**
  - Each change, swaps included, is listed as a fact with its own **Every time / Just today**.
  - The copy is fixed, and no model writes it.
  - Every time → `rework` writes it to `activity.how_to` in plain words ("alternate presses and
    rows; dead hangs one set at a time; hip thrust instead of glute bridge").
  - Just today → the change stays in the log only.
  - Nothing is learned without a tap.
- [ ] **6d. Eval.** Replay: a session after a saved structure → does `prescribe-session` follow
      `how_to`? Run `eval:tools` only if this touches the coach's actions (`rework` already exists).
- [ ] **6e. The agentic path: "rearrange this session" as a per-session job (R2).** The second
      path R2 ruled, beside the sheet, not instead of it. The person says it in chat ("spread the
      hangs out", "alternate the presses and rows") or taps **Something else** inside Rearrange, and
      the coach reorders **this session in place**, with no week replan to review and accept.
  - A small new AI Admin job (auditable, prompt change → sync-jobs): one session's groups of
    set-turns in (6a's shape), the same turns reordered out, nothing added or removed. It sits
    beside 5f's single-item alternative job; `revise_session` is the wrong size for it.
  - A coach action that calls the job, in the drawer, never always-on (TOOL-HARNESS checklist; it
    answers `changed:` / `nothing changed:` / fault). The hard rule in both places: she **reorders
    only**. A swap or a load change stays in Phase 5's paths, so her answer can be checked by
    counting turns before and after.
  - Her result lands the way a manual rearrange does: All steps shows the new groups, Undo takes
    it back, nothing is logged, and at the Recap it is one of the "You changed N things" with its
    own **Every time / Just today**. Nothing she arranges is learned without that tap (R5).
  - After 6a; can run alongside 6a′. Target the same ~20 s as 5f, shown with the same
    "asking · ~20 s" row, never blocking.

## Order and parallelism

- **Now:** Phase 1 (one PR) and Phase 4 (design) at the same time.
- **After R1/R4:** Phases 2 and 3 in parallel. 3a lives in its own new file. 2a and 3b both touch
  session building, so whichever lands second rebases.
- **After design (the canvas is complete as of 2026-11-03):** Phase 5, then Phase 6. Phase 6 uses
  5a's log shape; 6e (the rearrange job) needs 6a's shape and can run alongside 6a′.
- **Owner-only steps, per PR:** API deploy, phone rebuild, sync-jobs (3b, 5c), cleanup.
