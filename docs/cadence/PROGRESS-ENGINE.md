# The Progress Engine — design + build plan

Owner direction (2026-08-29): the Progress tab becomes a real analytics/progress surface — a
separate screen you can drill into and re-window deterministically — whose *composition* the coach
controls. Design mockups: https://claude.ai/code/artifact/ee27edbd-c6b6-43ff-bafd-446b30ab974b
(proposal, fold, practice-led composition, check-in flavour, two alternates).

## Principle

This is the tool-harness inversion applied to display: **she decides WHAT progress means; the
renderer decides HOW it is drawn.** The coach composes the page from a small semantic widget
grammar; deterministic code renders it, enforces the brand physics, loads the data, and re-windows
it. No model call is ever needed to *look at* your progress. This is SaaS controlled by AI — not
AI generating UI (unauditable, brand-unsafe), and not SaaS with an AI layer.

Three sacred requirements (owner):
1. A separate screen to look at progress.
2. Drill-down into stats from that screen (all deterministic).
3. A conversation about progress can be launched *from* that screen.

One caution shaping the grammar: **not everyone defines success linearly/temporally.** The grammar
has temporal and non-temporal families; the layout is ordered sections, never an imposed timeline.

## The widget grammar

Semantic kinds, not geometric ones ("rhythm", not "bar chart") — that keeps the coach's vocabulary
small, meaningful, and safe. One renderer file per kind (ESLint size gates). All inline SVG /
plain markup in the existing `viz.tsx` idiom — no chart library. Libraries give a geometric
grammar; the work here is the semantic layer with brand physics, which no library ships.

### Temporal kinds

| kind | shows | binds to | drill-down |
|---|---|---|---|
| `rhythm` | dot-rows of weeks; kept=forest, missed=neutral; detours as dusk shelter bands with check-in rings inside | occurrences by date + `check_ins` + `episodes` ranges (reuse `rollingConsistency`'s scheduled-days denominator) | the week's day list |
| `trend_vs_target` | headline trend number, line chart: EWMA bold, raw readings as pale dots, target as soft dashed horizon | `/progress` `latest_vs_target` (series/trend/rate/confidence — already shipped) | weigh-in list |
| `dated_sessions` | lollipops by date, best marked warmly ("your longest yet"), avg-HR quiet line, last-4-weeks beside period | `occurrences.log` + `workout_history` (incl. HealthKit/watch) | the dated session list (A8's ruling: the list, not the average) |
| `weekly_bars` | quiet weekly bars (steps, kcal); absent week = "not read" mark, never a zero bar | `health_digests.dailySteps.byWeek`; nutrition summaries | the week detail |

### Non-temporal kinds

| kind | shows | binds to | drill-down |
|---|---|---|---|
| `shelf` | bests & firsts — a collection of moments, no axis | `goal_events` (kind completion/note) | the event |
| `stage_path` | stage chips: done / current / ahead ("outline · part one · **part two** · revision") | goal milestones/stepping-stones | the goal |
| `count_toward` | n of target + flat bar (books 21/100, Psalms 78/150) | goal measure + `goal_events` count | the events list |
| `balance` | proportion of felt-states ("calmer after 6 of 8 sits") — counts what happened, never charts the bad half as a red series | `session_feedback` | the sessions |
| `total` | presence, not slope ("340 minutes sat", "31,200 words") | counted log units (`get_practice_totals` logic) | the log |
| `variety` | breadth ("14 different dinners this month") | `food_usage_ctx` | the food module |

### Page-level kinds

`recap_rail` (weekly check-in cards — needs recap persistence, below), `history` (the dated feed),
`journal_row` (unchanged; words in, words back — never analyzed or charted).

### Brand physics (enforced by the renderer, not by prompts)

- A missed day is **neutral** (`--surface-3`), never red. No streaks that reset. No broken states.
- Absent data reads **"not read"**, never zero. A blank day is not a bad day; unlived days don't render.
- Detours draw as **shelter** (dusk band), check-ins count inside them.
- Targets are horizons (quiet dashed line), never verdicts.
- Warm accent (`dawn`) marks *accomplishments only* (longest yet, a finished book) — never deficits.
- Captions bind to **computed facts** (EWMA rate, kept/scheduled counts), not frozen prose — so
  re-windowing never needs the model and words never go stale. She authors the template once.
- Mood (`daily_checkins.mood`) is **not charted** without an explicit owner ruling.
- Nothing renders from `points_state`/`streak_state` until PLAN.md A12 is settled.

## The layout model

`cadence.progress_layouts`: one committed layout per user, `status draft → committed`,
`superseded` lineage (mirrors `plans`). A layout is ordered sections; each section is a widget
spec:

```json
{ "kind": "trend_vs_target", "id": "w-weight",
  "source": { "measure": "weight", "window": "inherit" },
  "caption": { "template": "easing {direction} about {rate_per_week} a week", "bind": "weight_trend" },
  "drill": "weigh_ins" }
```

**The default composition is computed, not stored**: a deterministic composer derives it from the
user's goals/areas (fitness-first by order only; a mind/practice-only user gets a practice-led page
with no time axis). No committed layout → default. This pre-built composition shows users what can
be tracked, costs zero tokens when they're happy with it, and means schema evolution never strands
anyone. The Week/Month/All control and every drill-down are parameters → Postgres. Never a model
call.

**Rendering contract** (closes the known harness gap "what a tool hands BACK is not gated"):
a shared `WIDGET_KINDS` registry in `@cadence/shared`; a contract test asserts every kind the
composer/coach may declare has a renderer and a binding resolver — the display-side twin of
declared-equals-executable. Unknown/unbindable kind → the section is omitted **with evidence** in
the payload (guards report evidence, never silent null).

## The progress talk (scoped conversation)

Follows the food-module segmentation — same coach persona, different context and tools:

- Launched from the Progress screen (the quiet dashed "Want this page to watch something
  different?" row, and from drill-downs with the viewing context carried as the note). Uses the
  existing `coachNote`/`autoSend` bridges.
- Composition tools (`compose_progress_view`, adjust/commit) are declared **only in this scoped
  context**. Nothing lands in `ALWAYS_ACTIONS`. The main chat gets one cheap door: she points at
  the progress talk (the `log_nutrition`-withdrawal precedent).
- Context pack: current/default layout, the grammar's kinds + what this user's data can bind, the
  user's goals. Composition runs through an AI Admin job with **strict json_schema → gpt-class
  models only** (primary AND failover catalog-verified; Devs.ai silently removes model ids).
- Flow: she proposes → preview card in the conversation → "here's what I heard — did I get it
  right?" → commit writes the layout (draft → committed). Whatever she works out is written back,
  so the deterministic rung hits next time.

## Check-in unification

The weekly check-in ("Your weekly check-in", canonical `recap`) is **this same screen scoped to
the closing week** — same widgets, same endpoints, `window = the week` — plus the coach's hosting
line and one act: confirm ("That's my week" / "Something's off — let's talk"). The distinct part
of the check-in is its act, not its display. One renderer, two surfaces; the diverging
WeekReviewSheet implementation folds into the shared widgets.

**Recap persistence** (the one real data gap): confirming writes a compact recap artifact —
`cadence.recaps` (user, week, facts snapshot, the coach's one-line conclusion, detour flag).
That row is what the `recap_rail` renders. Facts are recomputable; her conclusion is not — this
is the write moment.

## API work list

| item | size | notes |
|---|---|---|
| `GET /progress?window=` — parameterize `WINDOW_DAYS`, 7-day consistency, history cap | S | parameter change |
| `GET /progress/history?from&to` — occurrences (all statuses) + check-ins + episode ranges | S | `listOccurrences` takes ranges already |
| `GET /me/workout-history` | S | repo fn exists; client GET missing |
| `progress_layouts` migration + composer + `GET/PUT /me/progress-layout` | M | commit path via the talk only |
| `recaps` migration + write-on-confirm + `GET /me/recaps` | M | unlocks `recap_rail` + rail on both surfaces |
| Non-temporal reads: `goal_events` range, `session_feedback` summary, practice totals, `food_usage_ctx` variety | S each | shapes exist server-side |
| Nutrition month view: lift the 31-day cap (range param) | XS | |
| Water range read (`water_logs`) | XS | later; not in the default composition v1 |

## Build plan — waves, parcels, crew

**Working model:** Fable (this session) is team lead — briefs, API contracts, reviews,
integration, merge decisions. Coding/testing parcels run as **Sonnet agents** in isolated
worktrees (worktree traps: borrow deps but re-point `@cadence/*`, copy `backend/.env`,
`preview_start` runs main's code). **Parcel boundaries = full call path** — each parcel owns
server + client + tests for its feature, scoped by what must be true for it to work, not by where
the code lives. Every parcel: CI green (lint size gates, tests), brand-physics checklist, Fable
review before merge. **Merges land in waves** (Vercel Hobby build cap); `npm run
cleanup:test-data` after each wave. DB tests isolate by `zzq` names, never by deleting shared rows.

### Wave 1 — the page, deterministic (5 parcels in parallel, then 1 integration)

- **W1-1 Grammar renderers** (client): one component file per kind + `WIDGET_KINDS` registry
  (`@cadence/shared`) + contract test. Storybook-less visual sanity via preview.
- **W1-2 Windows & rhythm**: `?window=` through `buildProgress`; `GET /progress/history`; seg
  control; `rhythm` bound end-to-end (occurrences + check-ins + episodes).
- **W1-3 Sessions**: `GET /me/workout-history` + `dated_sessions` bound + drill-down list screen.
- **W1-4 Layout store + composer**: migration, deterministic default composer (per-area logic,
  practice-led path), `GET /me/progress-layout`, client renders page *from layout*.
- **W1-5 Non-temporal reads**: goal_events range / feedback summary / practice totals / variety
  endpoints + `shelf`, `balance`, `total`, `count_toward`, `stage_path`, `variety` bound.
- **W1-6 Integration** (after 1–5; Fable + one Sonnet): ProgressView assembly, drill-down routing,
  empty states per area (fix the "weigh-ins and wins" copy), skeletons, the talk row (stub: opens
  coach with a note until Wave 3), device pass via `cap run`.

Exit: the redesigned page live on the deterministic default. This is the mockup made real.

### Wave 2 — check-in unification

- **W2-1 Recaps**: migration + write-on-confirm + `GET /me/recaps` + `recap_rail` on the page.
- **W2-2 Week flavour**: WeekReviewSheet renders the shared widgets week-scoped (facts endpoint
  takes the window); confirm/act layer unchanged; receipt autoSend unchanged.

### Wave 3 — the progress talk

- **W3-1 Scoped surface**: conversation context pack (layout + grammar + data availability),
  entry points (page row, drill-down asks, main-chat pointer door).
- **W3-2 Composition job + tools**: strict-schema AI Admin job (gpt-class primary + failover,
  catalog-verified), preview card, draft→commit, `PUT /me/progress-layout`. Job prompts synced via
  `sync-jobs.ts` (not live until synced). Eval scenario for composition quality; verify prompts on
  a FRESH session. `npm run eval:tools` only if anything touches always-on lists (by design:
  nothing does).

### Wave 4 — polish backlog

All-time view tuning, weather annotations on outdoor sessions, water rows, month nutrition view,
alt forms if the owner picks one (bars vs dots; rail vs timeline).

### Separate small track — Settings (independent, any time)

(1) `overflow-x: hidden` on `.sheet-body` + the two real overflow fixes (Use-city button,
targets grid `minmax(0,1fr)`) + `overscroll-behavior` under `html[data-native]` — XS, one parcel.
(2) Sheet → full screen via the FoodHome idiom, sectioned; rename "Danger zone"; merge the two
"What we work around" sections; "Tools" label per BRAND.md — M. (3) Later tenants: trust screen,
account deletion, export — own design pass first.

### Estimates (calendar, with review gates)

Wave 1 ≈ 3–4 days · Wave 2 ≈ 1–2 days · Wave 3 ≈ 2–3 days · Settings track ≈ 1–2 days in
parallel. Roughly two weeks end-to-end with batched merges.

### Risks

- **Composition quality** — mitigated by the small grammar, strict schema, preview-then-commit,
  and the eval scenario; worst case is a bad *ordering*, never a broken or off-brand render.
- **Layout staleness** (goals change under a committed layout) — composer diffs available bindings
  on load; unbindable sections omit with evidence; she mentions it in the talk, never silently.
- **WeekReviewSheet regression risk** in W2-2 — the check-in just shipped (#280–282); keep the
  act layer untouched and gate on its existing tests + a device pass.
- **Schema-job latency** on non-gpt models — already ruled: gpt-class only for the composition job.
