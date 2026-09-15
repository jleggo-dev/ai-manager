# The check-in — the coach's half of the week

**Status: BUILT** (v3, 2026-08-27, `feat/weekly-check-in-rebuild`). Owner rulings 2026-08-25; the
approved mockup is `Cadence Check-in.dc.html` in the design project ("The coach calls the screens.
The screens do the work."). §1–3 below are the product reasoning that produced the build and still
stand; §4 onward describes what shipped, with file names — this is the reference, the earlier
chat-card architecture drafts are superseded.
**Read first:** [BRAND.md](BRAND.md), [TOOL-HARNESS.md](TOOL-HARNESS.md).

> **The governing sentence:** the check-in is a conversation the coach runs — entered by a sentence
> the user sends, served by tools SHE calls, rendered by deterministic screens the app owns. The
> app never orchestrates her; she calls the screens like tools, and every number on them comes from
> the log database, never from her prose.

---

## 1. How we got here: the tap that took two minutes

The owner tapped a meditation and a run on 2026-08-25 and waited ~63 seconds across the two.
Measured across 163 `prescribe-session` runs: `total ≈ 12.6s fixed + 8.4ms/output-char`; app-side
work averaged 76–153ms. The wait was one live coach call authoring the session **at first tap** —
the button was built at plan commit, its shape wasn't.

Owner: *"The activity isn't just the button, it includes the shape of the activity. If the button
is on the screen, the activities it represents should also be there."*

**Fixed** (step 1): `commitActivities` fires `prefetchImminentSessions` the moment occurrences
materialize, and the `GET /plan` backstop covers the whole 7-day view window (cheap via the
`has_session` list flag; overlapping passes dedupe per-occurrence). The device report's exact case
— a rolling-materialized row tapped 1s after plan load — is covered by the backstop, and the
rolling materialization itself is gone (§4).

## 2. The horizon was extending itself

Three clocks that never met: the view showed 7 days, `ensureHorizon` silently materialized 14 on
every load, the check-in gate ran on its own 7. Nobody could ever scroll to the end of their plan,
so the coach never got a natural moment to ask how the week went.

Owner: *"Just infinitely generating a plan doesn't really ensure success and success is what
we're after."*

**Fixed** (step 6): one constant (`DEFAULT_HORIZON_DAYS = 7`, imported by lock/commit/prefetch),
speculative `ensureHorizon` callers deleted (only the commit-path call remains), and
`rollingConsistency` excludes zero-occurrence days from its denominator — a week in check-in limbo
is a gap, never a miss.

## 3. What the old check-in was: a receipt

`recap.ts` (now deleted): the app computed everything, the model narrated a paragraph, and nothing
could change. Against the owner's three real coaches — piano teacher (new piece when one is
mastered), trainer (reads the scale, adjusts the plan), boss (unblocks, angles at growth) — every
real check-in **ends in a change**. A readout that ends in a paragraph is a receipt for a week you
already lived. That gap is what v3 closes.

---

## 4. As built — the loop

> Week ends → the trail says so → "Start my check-in" (a real, visible message) → she calls
> `open_week_review` → the card appears in the thread → Open mounts the full-screen review →
> toggles correct the log → "Confirm my week" → the receipt lands in the chat, visibly → she reads
> it and may put up swap cards with reasons → the Changes sheet applies what stays toggled on →
> the commit warms every session → "Week N is ready. First up: Tuesday, 7 — Easy run."

### The trail's end (step 6)
`computeWeekState` (plan-view.ts) returns `weekState: {ends_on, checkin_due}` — due iff the active
plan's week clock is ≥7 days old and no newer version exists. ~~**Any commit IS the week being
handled**~~ — superseded 2026-09-07 (see *The week clock and the wall* below): the clock is
`week_started_at`, carried forward by ordinary commits and reset only by the check-in exits.
Nothing else is tracked, nothing can be "overdue." Two independent layers render it
(`EndOfTrailCard.tsx`): a hard-to-break plain fallback, and the rich card ("Week {version} wraps up
today" — past tense once ≥2 days by) inside an error boundary whose fallback IS layer 1. A bug in
the nice card degrades to a plain button, never to a blank week.

### Entry is a sentence, visibly sent (steps 4/6)
"Start check-in" posts **"Start my check-in"** through the real send pipeline — a visible user
bubble and a real coach turn (`autoSend` on OnboardingChat; keyed latch since the tab never
unmounts; a dead session lands the text in the composer rather than eating the tap). Never a
whispered `<note>`.

### She opens the review (step 3)
`open_week_review` (always-on; the measured `update_constraint` 0-of-3 precedent is why) persists
`pending_week_review` (migration 0044) — the plan week, capped at today, so "late" needs nothing
special. The client polls (`WeekReviewCard`, ChangeCard's contract), renders the labelled card;
Open mounts the sheet. Tool calls never cross the SSE wire — persisted state is the only channel.

### The review is software (steps 2/4/5)
`features/plan/week-review/` + `week-review-facts.ts` (server): per-day grid — sessions
(planned/logged minutes), 3 meal slots, mind rows with named steps — all Postgres, no model.
Write-back is plain CRUD (`week-review-write.ts`: read-merge-write per the `correct_log` rule).
"Confirm my week" counts fixes client-side (`Confirm week · save N fixes`), dismisses the pointer,
and sends the receipt **visibly**: `Week confirmed — {S} of {St} sessions · {M} of {Mt} meals ·
{C} correction(s)`. She replies to it for real. The old surface (RecapPanel, `/plan/recap`,
`recap.ts`, the `weekly-readout` narration) is deleted.

### Changes end in a tap, never in her prose (step 7)
`propose_plan_change` edits now carry per-edit `reason` and `optional`; they land on
`PendingPlanActivity.change_reason`/`enabled`. ChangeCard shows **"Show me"** when per-item data
exists (plain old changes keep inline Apply), opening `features/plan/week-changes/`: NOW → NEXT
WEEK swap cards, the reason under each, toggles (optional starts off), "Nothing changes until you
tap this." Apply persists toggles then runs the one commit funnel — where `resolveToggledActivities`
(plan-partial-apply.ts) makes a declined edit **revert to the commitment's current version** and a
declined add disappear. `commitActivities` treats its array as the complete next plan; a bare
filter would have deleted what the user meant to keep.

### The trust path (steps 6/8)
"Just build my week" — never "Skip" — is a **commit, not a synthesis**: `buildNextWeek`
(week-build.ts) recommits the same activities, the new version materializes and warms, and the
ready push says the one fact worth saying: *"Week {N} is ready. First up: {weekday}, {time} —
{title}."* From the trail it's the card's button (`POST /plan/week/build`); from conversation it's
her `build_next_week` tool (always-on) — an exact-string interception of the say-text was rejected
as brittle, since say-texts are editable by design.

### The knock (step 8)
A push producer (`notify/producers/checkin-due.ts`), not the old ungated local nudge (removed in
the same change — it had no "already done" suppression and locals can't be server-cancelled).
Candidate: active plan's week clock ≥ `horizon_days` old (`week_started_at` since 2026-09-07 — see
the ruling below; it was `generated_at`); dedupe `target = week clock + horizon` — which never
changes while ignored, so it fires **once per stalled week-end and structurally cannot nag**.
Normal `notify()` path: quiet hours, caps, opt-in.

### Late, and the week nobody logged (edge cases)
Protocol blocks (`coach-picks-protocol.ts`) + a once-per-day context line ("Their plan week ended
N days ago; check-in not yet done" / "Last week has no logged activity" — date-context.ts). Late:
one warm line, two picks ("Run through last week" → `open_week_review`; "Just build this week" →
`build_next_week`), never "overdue," never counting days out loud. Empty: she must NOT open a
review of zeroes — one question, three answers ("Fine — I just didn't log" → `build_next_week`;
"Rough, honestly" → talk, then `propose_plan_change`; "Life got busy" → the existing detour).
Persona changes reach **new sessions only** (AI Admin snapshots at open).

### The week clock and the wall (owner ruling, 2026-09-07)

Owner: *"I still have never been prompted for a weekly check-in… I'm okay showing an endless
horizon, just as long as the check-in is static and we can't really move past it without doing so
explicitly."*

**What was wrong.** §4's "any commit IS the week being handled" timed the check-in off the active
plan's `generated_at` — and every commit inserts a new version with a fresh one: accepting a
proposal, an Adjust, adding a routine, a replan, the fan-out. An engaged user who touched their
plan at all restarted their week each time and never reached `checkin_due`. The push producer and
the coach's date line read the same column, so all three were quiet together.

**The clock (migration 0058, `services/week-clock.ts`).** `cadence.plans.week_started_at` is the
clock; `computeWeekState`, `extendHorizon`, the weekly_checkin candidate SQL
(`coalesce(week_started_at, generated_at)`), `open_week_review`'s window and date-context all read
it through one helper, so they cannot drift apart again. `commitActivities` **carries it forward**
from the version it supersedes; only the two check-in exits reset it to now: `buildNextWeek`
("Just build my week", `startsNewWeek: true`) and `POST /plan/week-review/recap` — the confirm-only
server call "Confirm my week" makes (`dismiss` is shared with "Not now", so it must not reset).
A confirm may commit nothing, which is why the route resets rather than a commit; a change the
coach then proposes and the user applies carries the fresh clock forward like any other commit.
A first-ever plan starts its week at its own commit. Backfill: `week_started_at = generated_at`.
Every commit still materializes `DEFAULT_HORIZON_DAYS` from today — the horizon stays visible,
which the owner is fine with; only the clock stopped moving.

**The wall (`features/today/trailLock.ts`, `LockedTrailDay.tsx`).** When `checkin_due` is true
the trail is a wall, not a card at the bottom of a scrollable next week: days through the later of
`ends_on` and today render normally, the `EndOfTrail` card stands right after them (TodayTrail's
`wall` slot), and every day from there on is **locked** — dimmed, `pointer-events: none`, the
day's titles as plain text under one line ("After your check-in"), no discs, no bay, no "A clear
day". The only ways past are the card's own "Start check-in" and "Just build my week", both
unchanged. `restEmpty` still shows the card for a week that ran out of content, but an empty week
is not a wall — locking keys off `ends_on` (and fails open on any date it cannot read).

### The wall stands mid-week, and the gate (owner rulings, 2026-09-09)

Owner: *"When I look long-term, I see blank days. It can show the future days and a potential
plan, but we have to check-in to unlock. Previously this was indicated on the plan, along with a
button to build the plan out without checking in."* And, settling the balance between the old
ever-growing horizon and the forced check-in: *"1) A planned week. 2) A weekly check-in or a
deliberately skipped weekly check-in. 3) Continued visibility into what the next week could look
like — future days appear as locked and when you select an activity it prompts you to either
begin a check-in or deliberately skip the check-in… When they arrive on the day a check-in was
planned for, it should still re-prompt."*

**What was wrong.** A week materializes once, at its commit, but the view is seven days from
today — so from the second day of a week the trail ran past the last written day, and those days
rendered as ordinary empty days ("A clear day — rest counts too"), with the wall, the lock and
the build button all held back until `checkin_due` flipped on day seven.

**The rulings, as built.**

- **An early check-in moves the check-in; an early build does not.** "Build next week"
  (`POST /plan/week/build-ahead`, `buildWeekAhead` in week-build.ts) writes the following week on
  the same rhythm through the check-in date plus one horizon and records the decision as
  `plans.built_through` (migration 0059). The week clock and `horizon_days` are untouched, so the
  check-in still lands on its day and still asks. A confirmed check-in resets the clock (as
  before) and clears `built_through` — the check-in can redefine the following week. A column,
  not "does the day have rows": an ordinary mid-week commit also materializes seven days from
  today as a side effect, and those days must stay locked. `commitActivities` carries
  `built_through` forward on an ordinary commit and clears it when the commit starts a new week.
- **Seven days from today, locked from the check-in on.** `trailLock.ts` has two dates:
  `wallDate` (where the card stands — the day after the later of `ends_on` and today) and
  `lockedFromDate` (where the lock starts — the wall, pushed out past `built_through`). Neither
  needs `checkin_due`. Locked days are muted but their discs are there: a day nothing has written
  yet draws the API's `preview` (`services/plan-preview.ts` — the plan's recurrences from the same
  anchor, no rows, no ids; `trailPreview.ts` turns them into stand-in nodes) under one line,
  "Locked until weekly check-in". **The check-in is a task on the day it is demanded** (owner,
  2026-09-13: "either as a task today or otherwise indicated in the UI… on the day where it's
  demanded" — and both places, the card too): a "Weekly check-in" node, last on `ends_on` (or on
  today once that day is past), that starts the check-in on tap with no prompt and never holds
  (`checkinOccurrence` in trailPreview.ts). The server's own retired check-in row stays retired —
  its date follows the plan's recurrence, not the week clock. The card stays (owner: "keep the
  card!") in two moments:
  **due** ("Week N wraps up today", *Start check-in* / *Just build my week*) and **ahead** ("Week
  N wraps up on Sunday", *Start check-in* / *Build next week*).
- **The gate** (`checkinGate.ts`, `WeekGateSheet.tsx`, `useWeekGate.ts`): a tap on a locked
  activity asks before it opens. Day 1–3: *"It's only day N of your plan"* → Build next week /
  Not yet. Day 4 on: *"We're still working through this week"* → Check in now / Build next week /
  Just browsing. On the check-in's day or later, a tap on any activity from the check-in on asks
  *"Do you want to check in today?"* → Check in now / Later today / Just build my week (the
  owner's "skip til next week", wearing the trust path's name — never "Skip"). *Later today*
  dismisses for the rest of the local day (per device) and opens what was tapped; the card
  stays, and a locked day still asks — it is the only door a locked day has. A preview node is
  never opened. The gate is table-tested (`checkinGate.test.ts`).
- **The coach can do all of it from chat.** `build_week_ahead` (tail tier, category `plan`)
  writes next week without moving the check-in; `build_next_week` still ends a finished week
  (the skipped check-in); `open_week_review` runs the check-in; `extend_horizon` runs this week
  longer. Eval cases A27 (fires) and C20 (must not) — **eval:tools run pending post-deploy**.

### The week is always written, and a confirm writes it (owner rulings, 2026-09-14)

Owner, on the morning after the check-in: *"We've gone from an endless horizon of always planned
plan, to the absolute opposite — no plan after a week. There is no plan for today or this week…
Cadence detects the plan, but it's not showing… I think we should always have the 2nd week
loaded, so there's always something to show, but Cadence needs to consider tweaking it in the
check-in. This last week I didn't get anything done, so probably the coming week should look like
the previous one did — reps should stay the same or possibly go down — if she's doing any
reasoning."* And on the plan's greeting: *"I immediately see the disrupted ask, which should only
display if I deliberately pull down."*

**What was wrong — the sequence, from the database.** v24 wrote seven days at its commit (6–13
Sep); the check-in day was 14 Sep, and no row had ever been written for it. At 07:26 the owner
tapped "Start check-in", opened the review, and confirmed it — *0 of 14 sessions · 3 of 24
meals* — which reset the week clock (`restartActiveWeek`) and, because a confirm may commit
nothing, wrote **no days at all**. The plan opened with "A clear day" on today and every day after
it; the coach, reading the same calendar, said the week "hasn't ended yet, so nothing needs
rebuilding" (her `build_next_week` had refused — the confirm had already started the week) and that
the sessions "should show up… worth a quick app restart." Step 6's "a week materializes once and
stops there" had been right when the check-in was timed off the rows running out; the week clock
(0058) removed that dependency and left the hole behind.

**The rulings, as built.**

- **The calendar is always written through the week after the view.** `buildPlanView` reads
  occurrences a week past what it shows and, when the far week is empty (`horizonFallsShort`,
  plan-horizon.ts — quiet on every ordinary load, since a written plan lands a row there), calls
  `ensureHorizon` for `writtenAheadDays(view)` — 14 from today for the 7-day view. The days past
  the check-in are still **locked** (trailLock.ts keys off `ends_on`, never off rows), and the
  check-in still redraws them: a commit wipes the outgoing plan's future pending rows and writes
  its own. Their real rows draw as the same muted discs the preview did; `plan-preview.ts` stays
  as the fallback for a day the top-up could not reach.
- **"Confirm my week" writes the week it starts.** `POST /plan/week-review/recap` follows the
  clock reset with the same fill, `keepElapsedToday` like a commit's own — the day they are
  standing in comes back in full, including the 6am they confirmed past. Best effort, like the
  clock: `GET /plan` tops the calendar up on its own on the next load.
- **Due by day, in their zone.** `computeWeekState(plan, timezone)` names `started_on` as the
  clock's local day, `ends_on` as that plus the horizon, and `checkin_due` from the first moment
  of `ends_on` in the user's zone — the day the trail already puts the check-in node and the
  "wraps up today" card on. It was due at the exact instant (clock + 7×24h), so a week begun at
  14:53 spent the check-in's whole morning with the screen saying "check in today" and the server
  — this flag, `build_next_week`'s guard, the coach's date line, `open_week_review`'s window —
  saying "still running". The weekly_checkin push's SQL reads the same local-day bound.
- **After the confirm, the coach reasons about the week ahead** (`AFTER_CONFIRM_RULES`,
  coach-picks-protocol.ts): the receipt is the start of her turn, not the end of theirs; the next
  week is already on the calendar, so she never calls `build_next_week` after it; **load follows
  what happened** — a week mostly done can build, and only on what was done; a week with little or
  nothing done holds (same sessions, reps, distances, loads) or eases, never progresses; and a
  miss is a fact, not a verdict — she asks what got in the way before easing anything. Her
  `build_next_week` refusal now says the week's days are already written, so "should show up,
  restart the app" cannot come back.
- **The shelf** (`proposalShelf.ts`, `usePullReveal.ts`): the app's own absence-noticed asks —
  `enter_disrupted` ("Life happened?", four dark days) and `rebaseline` ("Welcome back", seven) —
  no longer greet the plan on open. They wait above the trail behind a grip; a pull of
  `PULL_REVEAL_PX` from the top of the plan, or a tap on the grip, brings the banner out, and it
  stays out for that proposal for the session. A proposal the coach actually made (`replan`)
  shows itself as before. Table-tested (`proposalShelf.test.ts`, `PlanView.test.tsx`).

### The coach sees the calendar, edits it, and knows what you did to it (owner, 2026-09-15)

Owner: *"Shouldn't Cadence be able to see the calendar?"* — she could not. *"Whenever Cadence
calls to look at the plan, return the plan along with the calendar. But she should be able to
adjust the calendar and the plan. Part of the rule for moving things in the calendar was that
Cadence would know about it (moving, deleting, adding)."*

**What was wrong.** The plan has two layers — the RULES (each commitment with its repeat days) and
the CALENDAR (the dated rows the trail draws) — and every read the coach had was on the rules or
on the past: `get_active_plan` listed commitments and a "week shape" computed from them,
`get_consistency`/`get_recent_logs` looked backward. Nothing showed her the days ahead as written,
which is how she read "joint mobility, Mon/Wed/Fri/Sun, 6am" on 2026-09-14 and called it present
when nothing was. And the trail's hold menu (move / copy / delete a dated session, 2026-09-07)
told her nothing at all.

**As built** (`retrieval/calendar-function.ts`, `coach-action-edit-calendar.ts`, migration 0060):

- **The plan read carries the week as written.** `get_active_plan` — floor context on every
  turn — now reads the next 7 days of rows in its own batch and renders one compact line per day
  (today first, with ✓ done / ✗ skipped marks; meal logs folded to a count; an empty day said
  as "— nothing written"). A week with nothing on it is one sentence: *NOTHING is written from … —
  say so plainly rather than assuming the sessions are on it.* A failed read renders as a fault
  line, never as an empty week (TOOL-HARNESS.md step 4). Measured on the owner's 18-commitment
  plan: ~850 characters, ~210 tokens a turn.
- **`get_calendar`** (tail tier, `plan` category): the same view further ahead or back —
  `{"days": 14}` from today (default 14, up to 28), or `{"from": "2026-10-01", "days": 7}`.
- **`edit_calendar`** (tail tier, `plan` category, an ACTION that takes effect at once): move,
  copy or delete ONE dated session this week, named by date and title as the calendar shows them
  — the hold menu from chat, through the same `occurrence-edit.ts` service, so the week-window
  and same-day-conflict rules hold whichever door the edit came through. A rule change ("from now
  on, Thursdays") stays `propose_plan_change`; the descriptions carry that tiebreak and eval
  cases A28/A29 measure it.
- **She knows what you did.** Every successful move, copy or delete — from the trail or from
  chat — is recorded in `cadence.plan_edits` (0060: source, action, title, from/to dates), and the
  plan read renders the person's own edits from the past week: *Changes they made by hand on the
  plan screen: Mon 14 (today): moved "Hill intervals" from Tue 15 to Wed 16.* Her own edits are
  left out; a failed read says so. The record is best effort on both sides, so a missing table
  never blocks a move.
- **The drawer label** was brought back under `DRAWER_LABEL_MAX` by trimming nine hooks of words
  that decided nothing rather than raising the cap — the rule the tiers file asks for.
- Eval cases: A28/A29 (edit vs rule), B13/C21 (calendar read vs the floor), C20 allows the
  read. **eval:tools run pending post-deploy** (it measures the deployed API).

---

## 5. Verification state

Everything above merged on `feat/weekly-check-in-rebuild`: 1,608 api tests (140 files, including
the real-DB commit funnel) + 945 web tests, typecheck and `eslint --max-warnings 0` clean in both
workspaces. `eval:tools` baseline table lives in TOOL-HARNESS.md — first recorded run 73.1 F1 with
zero false-fires from the new always-on tools; re-run after any always-on change and append a row.
Migration 0044 applied. The `weekly-readout` job in `config/ai-admin/ai-admin.config.json` is now
orphaned (its only caller is deleted) — remove in a deployment-scoped change with a jobs sync.

## 6. Still open

- **Ad-hoc and quarterly** — deliberately out of this pass (mockup's own scoping). The quarterly
  is re-measurement + goal revision, replacing that week's check-in; `rebaseline` exists as its
  seed. `open_week_review` takes no window args yet; "look back on the past few months" needs them.
- **The receipt as a record, not speech** — the mockup styles the confirm receipt as a document-ish
  user-side card; today it's a plain user bubble with the same text.
- **Auto-open on tool call** — the review card ships with an Open button (no precedent for a sheet
  mounting itself); the mockup calls auto-open a tweak. One-line flip when wanted.
- **Standalone "your data, any time" surface** — the review opens via the coach today; a
  conversation-free door (Progress tab?) is unbuilt.
