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
plan's `generated_at` is ≥7 days old and no newer version exists. **Any commit IS the week being
handled**; nothing else is tracked, nothing can be "overdue." Two independent layers render it
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
Candidate: active plan ≥7 days old, no newer version; dedupe `target = generated_at + 7` — which
never changes while ignored, so it fires **once per stalled week-end and structurally cannot nag**.
Normal `notify()` path: quiet hours, caps, opt-in.

### Late, and the week nobody logged (edge cases)
Protocol blocks (`coach-picks-protocol.ts`) + a once-per-day context line ("Their plan week ended
N days ago; check-in not yet done" / "Last week has no logged activity" — date-context.ts). Late:
one warm line, two picks ("Run through last week" → `open_week_review`; "Just build this week" →
`build_next_week`), never "overdue," never counting days out loud. Empty: she must NOT open a
review of zeroes — one question, three answers ("Fine — I just didn't log" → `build_next_week`;
"Rough, honestly" → talk, then `propose_plan_change`; "Life got busy" → the existing detour).
Persona changes reach **new sessions only** (AI Admin snapshots at open).

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
