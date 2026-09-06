# REQ8 — Task walkthrough, tool registry & rewards

> Status: **design + first engines landed** (2026-07-27). The pure logic spine is built, tested,
> and green; the wiring, persistence, and UI are scoped below as follow-on slices.
> Companion assets: the redesign handoff lives in
> [`docs/cadence/design/redesign-today-trail/`](./design/redesign-today-trail/) (README + prototype +
> 12 screens). See also [[PLAN]], REQ4 (streaks/episodes), REQ5 (food tools), REQ6 (mind pillar).

## 1. Problem & the reframe

The redesign turns a task from "a row you tick" into a **guided walkthrough**: tap a node → a
pre-flight **start sheet** (the step summary + _Start_ / _I have less time_ / _Indoor swap_) → a
full-screen **step-by-step** flow → a **celebration**. Founder steer from the working session
(2026-07-27) sharpened what's actually missing:

- **The coach already composes the steps.** `synthesize_plan` / `prescribe_session` already emit an
  `OccurrenceSession` — ordered items with `sets/reps/load/duration/detail/video_query`, and the
  type is deliberately generic ("items, not exercises — a practice-area session flows through the
  same pipe"). Generation is _not_ the gap.
- **The gap is rendering + a tool palette.** What's missing is (a) a framework that _renders_ each
  step with the right interactive **tool**, and (b) a growing **catalog of tools** the coach can
  compose from. We already have some tools (fitness how-to video, nutrition capture/rings); more
  arrive on the roadmap.
- **Insights aren't a separate dashboard — they're tools baked into tasks.** e.g. "Log a meal"
  opens with the macro **rings**; a run's celebration shows the **pace trend**. The Progress tab
  becomes the archive; live insight surfaces migrate into the relevant task's first/last step.
- **Capture is per-tool.** The walkthrough must still feed the coach. Each tool declares what it
  writes to the `OccurrenceLog`, so the pretty flow keeps the adaptation signal (a reps tool emits
  sets×reps×load, a photo tool emits the meal, a journal tool emits the note).

**Design principle (carried from REQ5):** every capability is _a service the app renders now + a
tool the coach can call later_ — one implementation, two entry points. The same catalog the
walkthrough renders is the tool list the coach eventually calls itself (the agentic direction).

## 2. The step → tool model

Canonical types + pure projection: **`packages/cadence-shared/src/walkthrough.ts`** (tested in
`walkthrough.test.ts`). It is dependency-free so both the API (to serve) and the web (to render
`condense()` locally) can use it.

A task plays as an ordered list of **`WalkthroughStep`**, each carrying `{ title, body, minutes,
tool, video_query?, skippable, core? }`. `minutes` is explicit per step; the task total is the
**sum** (never distribute evenly when real per-step times exist). `core` marks the load-bearing
step the short version must never drop. `video_query` rides alongside _any_ tool (a how-to link).

### The tool catalog (`StepTool`)

| Tool       | Config                   | Capture        | Notes                                                            |
| ---------- | ------------------------ | -------------- | ---------------------------------------------------------------- |
| `read`     | —                        | done           | A cue to follow (mindset prompt, mobility drill).                |
| `timer`    | `seconds`, `chime?`      | done           | Plank 30s, meditate 5 min, easy-run 20 min.                      |
| `reps`     | `sets`, `reps?`, `load?` | **structured** | Cycle sets; emits the set log.                                   |
| `checkoff` | `label?`                 | done           | "Did it" — a distance target, a simple task.                     |
| `photo`    | `prompt`, `purpose`      | **structured** | Meal / progress / form photo.                                    |
| `journal`  | `prompt`, `mode`         | **structured** | Text / voice (STT) reflection.                                   |
| `measure`  | `metric`, `unit`         | **structured** | Weigh-in and the like.                                           |
| `rings`    | `source:'nutrition'`     | none           | Insight tool — the macro rings.                                  |
| `insight`  | `card`                   | none           | Insight tool — consistency / count / countdown / trend / streak. |

**Capture classes** (`stepCaptureMode`): _orient_ (`rings`/`insight` — write nothing), _guided_
(`read`/`timer`/`checkoff` — the log records only that it happened), _capture_
(`reps`/`photo`/`journal`/`measure` — structured data that **becomes** the `OccurrenceLog`). The
completed occurrence's log is the **union** of what each capture step emits, with a bare "done" as
the floor and an optional free-text step as a catch-all. This is how the walkthrough replaces the
old free-text "how did it go?" without starving progression/adaptation.

### Derivation

`deriveWalkthrough(session)` flattens `blocks[].items[]` into steps; `inferTool(item)` picks the
tool by quantity precedence: **sets → `reps`, duration → `timer`, distance → `checkoff`, else
`read`**. Insight/nutrition/weigh-in tools are _attached by the caller_ (deterministic rule or the
coach), not inferred from a prescription item. `condense(w)` produces the **"I have less time"**
version — keep the setup step + the core at half (min 2 min); ≤2 steps kept whole; the core is
never dropped. (Example: a 4-step run `[3,2,20,5]` → `[warm-up 3, run 10]` = 13 min, matching the
prototype.)

## 3. Tool registry (client) & coach catalog (guardrail)

- **Web tool registry** — `tool.kind → renderer`. Adding a tool = add a `StepTool` variant + a
  renderer; nothing else changes. Insight renderers **reuse the existing components**
  (`MacroRings`, `ProgressCardView`, `Sparkline`), so they're already built.
- **Coach-facing catalog** — the list of tools that _exist_ (with inputs), injected into the coach
  the same way weather/context already are (`weatherVarsForUser`-style). This is the guardrail: the
  coach composes only from real tools, so the palette grows deliberately, never by hallucination.
  **Default posture:** deterministic placement rules first ("meal tasks open with `rings`"), coach
  override second — matching the per-goal `plan_mode` / AI-intensity thinking.
  **✅ Built (2026-07-28)** — `packages/cadence-shared/src/tool-catalog.ts` is the single source of
  truth; the api whitelist derives from it, a compile-time guard requires a client renderer per tool,
  and `renderCoachToolCatalog()` is injected into `prescribe-session` as the runtime
  `{{tool_catalog}}` variable (so the coach's palette can't drift from what the app renders/accepts).
  See `docs/cadence/PLAN.md` § "Tool catalog — the coach's single source of truth".

## 4. Insights baked into tasks (the dashboard, redistributed)

Every current Progress surface is already **deterministic** (`services/progress.ts` — "no LLM
anywhere in this surface"), so each becomes an insight tool the coach _or_ a plain rule can drop in
with zero generation. Inventory → placement:

| Surface today                                 | As a step-tool, in…                                      |
| --------------------------------------------- | -------------------------------------------------------- |
| Macro **rings** (kcal/protein/carbs/fat left) | first step of "Log a meal"; a "Nutrition check-in" task  |
| Eat-back slider                               | a step in a workout's completion                         |
| Nutrition insight ("eat more spinach")        | closing step of the meal task / an end-of-day reflection |
| **consistency** ("3/7 days")                  | morning mindset check-in, or the celebration             |
| **count** ("2/12 books · +add one")           | already task-shaped — the "+add one" is its capture step |
| **latest_vs_target** (weight + sparkline)     | first step of the weigh-in task, then capture            |
| **countdown** ("marathon 88 days out")        | opening step of the run task (motivation)                |
| **trend** (pace / top-load sparkline)         | run/lift celebration ("pace: 6:10 → 5:55")               |
| History feed                                  | stays in the **Progress tab** (the archive)              |
| streak + freezes                              | header pill + "+1 day" on celebration                    |

Resulting IA: **Today (trail) = _do_ · inside tasks = _orient/reward_ · Progress = _review_.**

## 5. Rewards — habit-first points, redeemable for freezes

Engine: **`apps/cadence-api/src/services/points.ts`** (tested in `points.test.ts`), pure &
forward-only like `metrics.ts`. Points reward the brand promise — _building better habits_ — not
raw output. Four composable, tunable sources (owner steer 2026-07-27):

1. **per completed task** — the redesign's "+10".
2. **a completed day** — bonus when every _due_ task got done.
3. **weekly active minutes** — earned even if not everything's done (showing up counts).
4. **streak length** — a small daily bonus that scales with the run (capped).

Points are **redeemable for streak freezes** (`redeemFreeze`, default 100 pts → 1 freeze, refused
at the freeze cap) — effort banked on good weeks buys protection for a bad one, the same "life
happens, momentum shouldn't reset" posture as REQ4. `balance` is spendable; `lifetime` only grows.
`pointsForDay` folds daily via `advancePoints`; `pointsForWeekMinutes` is added once at the week
boundary so the two never double-count. **Brand check pending:** streaks were a debated
reinstatement; XP/points lean further Duolingo — confirm tone/labels before surfacing.

## 6. Weather & indoor swap

Not net-new: `apps/cadence-api/src/services/weather/` already provides OWM current + short forecast,
`isOutdoorActivity`, and injects weather into the coach. The start sheet's **Indoor swap** is just
an alternate walkthrough generated for an outdoor task on a bad-weather day (another session-gen
call, or a deterministic swap). Caveat: the Week view's multi-day forecast column needs the forecast
window widened (today `~24h`, `cnt=8`); the design already blanks days beyond the window, so this
degrades gracefully.

## 7. What's built vs. next

**The ruck round (2026-09-06)** — one 110-minute ruck found seven gaps in the timer, the reps
tool and the finish, all closed together:

- **The timer keeps time from the wall clock** (`tools/useWallClock.ts`), so leaving the app to
  start a podcast loses nothing; a native local-notification **alarm** is booked for the target
  (`localNotifications.scheduleAlarm`, id `TIMER_ALARM_ID`, which plan syncs step around) so the
  bell rings from a pocket. The iOS audio session is `.playback` + `.mixWithOthers` so chimes
  sound under the silent switch without stopping the podcast; WebAudio uses one context unlocked
  on Start (`chime.ts`).
- **The timer on the lock screen** (2026-09-06, follow-up): an iOS Live Activity —
  `ios/App/App/CadenceLiveActivity` (plugin), `ios/App/CadenceTimerWidget` (the widget target
  that draws it), `Shared/TimerActivityAttributes.swift` (the one shape both share). The app hands
  over instants and the lock screen counts on its own: remaining counts down and rests at 0:00,
  elapsed counts up forever, so a ruck that runs long reads as such with the app asleep. Written
  blind — see the plugin README for the Xcode first-open steps and the device checklist.
- **Holds vs efforts** (`step-cues.ts`): a timer of ≥10 min is `open_ended` — it chimes at the
  target, keeps counting, and **Stop logs the minutes actually spent** (110, not 50); a short hold
  still auto-advances. the coach states `per_side: true` on a two-sided hold (catalog field) and the
  step gets `switch_sides`: a halfway chime and a visible "Switch sides"; the cue-text read
  ("each side / switch sides") is only the fallback for sessions prescribed before the field. **"Did it already"** logs a session done off the
  phone at the minutes named. The recap line for a done timer is the elapsed time, never the
  prescription.
- **Reps auto-advance** on the last set (same `useHandoff` contract as the timer); re-opening a
  chip inside the beat cancels it.
- **One tool instance per step** — the shell keys the tool by step id; two consecutive timers had
  been sharing one component instance, so the second opened with the first's finished clock.
- **Body check-ins** — a `feeling_log` whose title names a body part ("Knee check-in") is rerouted
  to a `checkoff` with a `prompt` (free words about the part); the catalog now tells the coach
  the feeling log is about the head only.
- **The finish question is decided by minutes** (`sessionOutcome.ts`): a ruck with a one-minute
  check-in is a movement session and gets "How did it feel?", not "How's your head now?".
- **Done closes at once** (`StartSheet.handleComplete`): the parse-session-log write runs behind
  the closed sheet and refreshes the plan when it lands, instead of holding "Done" for 15 s.

**Built & green now (all three workspaces: typecheck + lint + prettier + tests):**

_Walkthrough projection & tools_

- `packages/cadence-shared/src/walkthrough.ts` — `StepTool` catalog, `WalkthroughStep`,
  `deriveWalkthrough`, `inferTool`, `condense`, `stepCaptureMode` (+ unit tests).
- **Coach specifies the tool** — `SessionItem.tool` (`SessionItemTool`) added; `inferTool` now
  HONORS the coach's explicit choice and only falls back to quantity inference when it's unset (so
  a 1-min plank → `timer`, a 1-min "find a seat" → `read`); `normalizeSession` whitelists the tool
  (off-catalog values dropped). The `prescribe-session` job prompt (config-as-code) now teaches the
  catalog + the timer judgment. **Needs `npm run sync-jobs`** to reach the deployed coach — inert
  until then (untagged items infer exactly as before; fully back-compatible).
- **Timer tool (first interactive tool)** — `apps/cadence-web/src/features/walkthrough/tools/`:
  pure `timer.ts` state machine (+ tests), `useStepTimer` (1s interval, fires once on completion),
  `StepTimer` renderer (m:ss + elapsed bar + Start/Pause/Reset), `chime` (WebAudio, gracefully
  silent). Not yet mounted — drops into the walkthrough shell (slice 3).

_Rewards (parked per owner — foundation only)_

- `types/rewards.ts` (`PointsState`/`PointsView`), `services/points.ts` engine (+ tests), migration
  `0020_points_state.sql` **APPLIED + VERIFIED LIVE** (8 users backfilled, advisor-clean), repo
  `points_state` + `setPointsState`. The finalize / route / UI are deferred.

**Next slices (roadmap):**

1. **More tools** (current focus) — reps cycler, journal (text/voice), photo, checkoff, breath
   pacer (mind). Each = a `StepTool` variant (already defined) + a web renderer + the catalog line
   the coach now gets. The timer proved the pattern.
2. **Serve the walkthrough** — attach `walkthrough` (+ `walkthrough_short`) to the occurrence-detail
   response, server-derived from the cached session. Additive; testable without UI. (No DB.)
3. **The walkthrough shell** — start-sheet → step player → celebration, with a tool registry
   (`kind → renderer`) mounting `StepTimer` et al.; evolves `OccurrenceSheet`.
4. **Lightweight "started" state** — the trail's vibrancy needs "touched but not done" (today only
   pending/done/skipped/missed/paused).
5. **Rewards finalize** (deferred) — combined streak+points daily fold, `redeem-freeze`, `points`
   on the plan response. _Fold streak+points together over one day-walk to avoid an off-by-one
   between the two watermarks._

## 8. Open threads / decisions deferred

- **Today surface** — full trail vs. hybrid (trail + a compact status glance). Leaning: bake
  insights into tasks (§4) so the trail can stand alone, but keep a nutrition surface reachable.
- **Week variant A vs B** — **decide in-app**: build both behind the review switch (as the
  prototype does), choose on real data.
- **Who places insight tools** — deterministic default rules vs. coach-chosen (leaning: default +
  override).
- **Points tone** — brand gut-check on XP/points labeling before it ships (§5).
- **Food tab** — the design keeps the shipped 4-tab nav (Today/Coach/Food/Progress); a prior REQ5
  note wanted nutrition contextual. Confirm we're keeping the Food tab.
