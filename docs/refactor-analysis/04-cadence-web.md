# 04 — `apps/cadence-web` Refactor Analysis

Scope: `apps/cadence-web/src/**` (26 source files + 1 stylesheet). Analysis-only — no source
changes made. Rubric, priority/effort/risk scales shared with the other 5 audit agents (see
task brief). Every line number below was read from the actual file, not inferred.

## 1. Executive summary

`apps/cadence-web` is a young (single-author-feeling, internally consistent) Vite/React PWA.
Code quality at the statement level is good: **zero `any`/unsafe casts anywhere in `src`**, no
`TODO`/`FIXME` left behind, `tsconfig.json` runs `strict: true` **and**
`noUncheckedIndexedAccess: true`, and the brand voice is — impressively — followed correctly in
almost every string a user actually sees (see §4). The problems here are exactly what the brief
predicted for a younger codebase: **foundational and structural, not stylistic**.

The three headline findings:

1. **Zero tests, zero CI wiring, for the entire product.** There is not one `*.test.*`/`*.spec.*`
   file under `apps/cadence-web`. Root `package.json` workspaces are
   `["backend", "frontend", "packages/types", "packages/client", "packages/edge"]` — this omits
   `apps/cadence-web`, `apps/cadence-api`, **and** `packages/cadence-shared`. None of `npm run
   ci` / `typecheck` / `lint` / `test` / `prepush` at the root touch any Cadence code. A
   Cadence-web-only PR that breaks the plan-commit flow can merge cleanly through the only gate
   that exists today (`apps/cadence-web`'s own `tsc -b` via its local `build` script, run
   manually, if at all). This is the single biggest risk in this audit slice.
2. **No data-fetching/cache layer and heavy prop-drilling.** Every screen hand-rolls its own
   `useEffect(() => { getX().then(setX) }, [dep])`. The same nutrition-day fetch is duplicated
   three independent times (`TodayDashboard`, `OccurrenceSheet`, `SettingsSheet`'s
   `NutritionTargets`), and a manual `reloadKey: number` prop is threaded
   `PlanView → TodayDashboard`/`OccurrenceSheet` as a hand-rolled cache-invalidation signal.
   Two near-identical card-rendering switch statements (`TodayDashboard`'s `DashCard`,
   `ProgressView`'s `Card`) and two near-identical occurrence-row components
   (`TodayDashboard`'s `RhythmRow`, `PlanView`'s `Item`) exist because nothing is shared.
3. **The capability seam (`lib/capability/`) is built but unused, while the one genuinely
   native-adjacent feature bypasses it.** `webCapabilities` (the whole point of the seam per
   `CLAUDE.md` §Cadence) is imported by **zero** files — it's dead scaffolding today. Meanwhile
   `MicButton.tsx` calls the browser `Web Speech API` directly; under the Capacitor iOS wrapper
   mentioned in `package.json`'s own description ("native calls go through the capability seam"),
   `SpeechRecognition` won't exist in a WKWebView, so the feature will silently vanish (it's
   feature-detected to render `null`) instead of routing to native STT. This is exactly the kind
   of seam violation the brief asks to flag.

Brand/nomenclature compliance is genuinely strong — see §4 for the two real findings (both about
the pre-rename `Broker` name surviving in dev-only surfaces, not user-facing copy). No P0s were
found under the strict "line-count + responsibility-count" or "security" rubric definitions;
the nomenclature drift in `lib/api.ts`'s exported `DevTrace` type is called out as fitting the
**letter** of the P0 nomenclature criterion even though its current blast radius (dev-only,
`?dev=1`-gated) is small — flagged as P1 with a strong recommendation to fix now, before more
call sites accrue.

**Counts:** 26 files scanned (25 TS/TSX + `styles.css`) · **0 P0** · **4 P1** · **7 P2** · **15
P3** · **2 brand-nomenclature findings** (both dev-only surfaces, not user-facing) · **0 test
files** anywhere in the package.

## 2. File inventory

| Path | Lines | Primary role | Flagged? | Priority |
|---|---|---|---|---|
| `src/App.tsx` | 113 | Top-level screen state machine + auth gate | Y | P2 |
| `src/main.tsx` | 9 | React root mount | N | — |
| `src/vite-env.d.ts` | 1 | Vite type reference | N | — |
| `src/styles.css` | 527 | Global stylesheet (all components, unscoped) | Y | P2 |
| `src/lib/api.ts` | 497 | HTTP client for every backend domain | Y | **P1** |
| `src/lib/supabase.ts` | 15 | Supabase auth client (auth only, not app data) | N | — |
| `src/lib/capability/index.ts` | 34 | Capability-seam interfaces (health/push/location) | Y | P2 |
| `src/lib/capability/web.ts` | 31 | Web no-op capability implementation | Y | P2 |
| `src/components/MicButton.tsx` | 100 | Voice-dictation button (Web Speech API) | Y | P2 |
| `src/components/Orb.tsx` | 45 | Coach-mark SVG logo | N | P3 |
| `src/components/PhoneFrame.tsx` | 32 | Device-chrome shell wrapper | N | P3 |
| `src/components/Stepper.tsx` | 18 | Onboarding step indicator | N | P3 |
| `src/components/viz.tsx` | 131 | Shared inline-SVG viz primitives (Sparkline/Ring/DotRow/CountBar/MacroRings) | Y | P3 |
| `src/features/auth/AuthScreen.tsx` | 130 | Sign-in/sign-up screen (Supabase) | Y | P2 |
| `src/features/welcome/Welcome.tsx` | 66 | First-run intro + name capture | N | P3 |
| `src/features/onboarding/OnboardingChat.tsx` | 231 | Coach chat (onboarding + ongoing tab) | Y | P2 |
| `src/features/review/ReviewScreen.tsx` | 648 | 4-step review/curate/lock wizard | Y | **P1** |
| `src/features/plan/PlanView.tsx` | 230 | Today/Week tab container | Y | P2 |
| `src/features/plan/OccurrenceSheet.tsx` | 487 | Session/meal/weigh-in/baseline detail sheet | Y | **P1** |
| `src/features/plan/AdjustSheet.tsx` | 119 | "Adjust my plan" steer→preview→confirm sheet | N | P3 |
| `src/features/today/TodayDashboard.tsx` | 294 | Visual Today module dashboard | Y | **P1** |
| `src/features/progress/ProgressView.tsx` | 156 | Progress tab (cards/trends/history) | Y | P2 |
| `src/features/settings/SettingsSheet.tsx` | 214 | Settings sheet + nutrition targets + danger zone | Y | P2 |
| `src/features/shell/MainTabs.tsx` | 99 | Signed-in tab shell | N | P3 |
| `src/features/dev/DevPanel.tsx` | 159 | Dev-only "X-ray" trace panel | Y | P3 |
| `src/features/dev/AccountSwitcher.tsx` | 52 | Dev-only account switcher | N | P3 |

## 3. Detailed per-file refactor plans

### P1 — `src/features/review/ReviewScreen.tsx` (648 lines)

**Current problems**
- Single component owns: 4 wizard steps (`goals`/`you`/`gear`/`lock`), weight/height unit
  conversion math, goal-realism assessment, and the preview→lock commit flow — at least 4
  distinct responsibilities in one function body (lines 106–676).
- 10 `useState` hooks in one component (lines 116–125): `data`, `step`, `busy`, `preview`, `msg`,
  `weightDraft`, `hCmDraft`, `hFtDraft`, `assessing`, `assessments`. Several exist purely to solve
  the "draft vs. committed" input problem (lines 181–227) — a reusable `useDraftField` hook would
  collapse `weightDraft`/`hCmDraft`/`hFtDraft` into one abstraction.
- Unit-conversion logic is embedded directly in the component: `commitWeight` (195–204),
  `commitHeightCm` (214–220), `commitHeightFt` (221–227), with hand-rolled plausibility clamps
  (`plausibleKg`, line 184) guarding against a **previously-shipped data-corruption bug**
  (comment at line 185: *"Guard a previously-corrupted `current` (pre-fix data)..."*). This is
  exactly the kind of pure, business-critical, currently-untested logic that should be extracted
  and unit-tested first.
- `groupByGoal` (lines 36–50) is a pure function embedded at module scope in a 648-line file
  instead of `lib/` — fine location-wise, but untested.
- The render body (338–676) inlines all 4 steps' JSX directly with no per-step subcomponents —
  `goals` step alone is ~185 lines (347–522) including a nested goal-assessment card (475–507).
  `OccurrenceSheet`-style prop-callback spaghetti isn't present here, but the JSX nesting depth
  makes this file hard to skim or diff.
- Zero tests on the single most business-critical flow in the product: `doPreview` (283–304) →
  `doConfirmLock` (307–329), including the `recoverIfAlreadyCommitted` (270–280) split-brain
  recovery path for a dropped network response after a plan already committed server-side.

**Proposed target design**
- `features/review/useReviewWizard.ts` — hook owning `data`/`step`/`busy`/`preview`/`msg` and the
  `doPreview`/`doConfirmLock`/`doDismissPreview`/`recoverIfAlreadyCommitted` functions. Fully
  testable without rendering DOM.
- `features/review/useDraftField.ts` — generic `(committed, commit) => [shown, setDraft, onBlur]`
  hook replacing `weightDraft`/`hCmDraft`/`hFtDraft` (and reusable elsewhere, e.g.
  `OccurrenceSheet`'s `weight` state).
- `features/review/unitConversion.ts` — pure exports: `kgToLbs`/`lbsToKg`/`cmToFtIn`/`ftInToCm`/
  `plausibleKg`, each independently unit-testable (this is where the prior corruption bug lives).
- Split render into `GoalsStep.tsx`, `AboutYouStep.tsx`, `GearStep.tsx`, `LockStep.tsx` — each
  takes the slice of `data`/`baseline`/`equipment` it needs plus the relevant mutators, composed
  by a slimmed `ReviewScreen.tsx` (~120–150 lines) that only owns step navigation + the head/lockbar
  chrome.
- `groupByGoal` moves to `features/review/groupByGoal.ts` (pure, tested).

**Migration plan**
1. Extract `unitConversion.ts` + `groupByGoal.ts` first (zero behavior risk, pure functions) and
   write tests against them using today's exact values (round-trip kg↔lbs, cm↔ft/in, the 20–500kg
   plausibility clamp).
2. Extract `useDraftField` and rewire the 3 existing draft states through it; confirm no behavior
   change via manual smoke test (no automated coverage exists yet for the wizard shell).
3. Extract `useReviewWizard` (state + async handlers) with the render body untouched, passing the
   hook's return values through unchanged prop names — minimizes JSX churn in this step.
4. Split JSX into the 4 step components, one PR each to keep diffs reviewable.
5. Add integration tests (`ReviewScreen.test.tsx`) mocking `lib/api.ts` for: happy-path lock,
   `needs_focus` message, `recoverIfAlreadyCommitted` triggering after a network drop.

**Test-first requirements:** unit-conversion round-trips and the lock/preview state machine
**before** any JSX is moved — this is the file where a silent regression (e.g. the weight-corruption
class of bug already seen once, per the code's own comment) is most costly.

**Dependencies/blockers:** none technical; coordinate with whoever owns `apps/cadence-api`'s
`/review/*` and `/plan/lock`/`/plan/preview` routes if response shapes are also being reworked
(see §5).

**Priority:** P1 · **Effort:** L (>2 days — 4-way step split + hook extraction + first tests) ·
**Risk:** Medium (high-traffic screen; mitigate by doing extraction in the order above, cheapest/
lowest-risk pieces first).

---

### P1 — `src/lib/api.ts` (497 lines)

**Current problems**
- One file is the HTTP client for **6 unrelated domains**: dev-account/auth headers (17–60),
  coach chat streaming (62–135), plan/occurrence view models (137–247), progress (249–263),
  nutrition (265–378), replan/proposal (380–422), review CRUD (424–494), and dev "X-ray" trace
  (496–539). This is a Single-Responsibility violation at the *module* level — nothing here is
  wrong individually, but reviewing or testing "the nutrition API" requires opening a 497-line
  file with coach-streaming SSE parsing at the top.
- `sendCoachMessage` (94–135) hand-parses SSE frames (buffer/line-split, skip `message.complete`/
  `v2.response.created` control frames, detect `[DONE]`) — the highest-complexity *pure-ish*
  logic in the file, and per the neighboring comment block (122–126) this exact class of bug
  ("duplicated the whole message in the UI") has already shipped once. Zero tests.
- **Nomenclature drift**: `DevTrace.brokerSelect` / `DevTrace.brokerSelect.calls` /
  `brokerSummarize` (lines 508–509) use the pre-rename name `Broker`. Per `docs/cadence/BRAND.md`
  nomenclature table, the canonical internal name is now `Scribe` ("Broker (capture AI) → Scribe
  ... internal name that leaks safely"). This is an **exported, consumed** (`DevPanel.tsx` imports
  `DevTrace` and renders `t?.brokerSelect`) type field name — exactly the "nomenclature violation
  baked into a data-model-adjacent field name" P0 pattern, downgraded to P1 here only because the
  surface is dev-only and gated behind `?dev=1` (see §4 for the full brand finding).
- Every response-shape interface (`ReviewData`, `PlanOccurrence`, `PlanDay`, `PlanActivity`,
  `PlanViewData`, `OccurrenceDetail`, `Meal`, `MealMacros`, `NutritionDayData`, `DevTrace`,
  `AiLogEntry`, etc.) is hand-declared here rather than imported from a shared contract package,
  even though `@cadence/shared` already models closely-related domain shapes (see §5 for the
  cross-boundary drift risk this creates).
- No test file exists (contrast: AI Admin's `frontend/src/services/api.ts` has a sibling
  `api.test.ts` — see §5).

**Proposed target design**
- `lib/api/http.ts` — `BASE`, `headers()`, `setAuthToken`, `isDevMode`, dev-account helpers. The
  shared low-level primitives every other module imports.
- `lib/api/coach.ts` — `openCoachSession`, `getCurrentCoach`, `sendCoachMessage` (+ extract the SSE
  parsing loop into a pure `parseSseChunk`/`SseFrameReader` helper that's independently testable
  without a real `fetch` stream).
- `lib/api/plan.ts` — `getPlan`, `setOccurrence`, `replan`/`previewReplan`/`dismissReplanPreview`,
  `acceptProposal`/`dismissProposal`, plus the `PlanViewData`/`PlanDay`/`PlanOccurrence`/
  `PlanActivity`/`PendingProposal` types.
- `lib/api/occurrence.ts` — `getOccurrenceDetail`, `logOccurrence`, `recordWeighIn`.
- `lib/api/nutrition.ts` — everything in the current 265–378 block.
- `lib/api/review.ts` — `getReview`/`confirmGoals`/`lockPlan`/`previewPlan`/`dismissPlanPreview` +
  goal/equipment/baseline/name CRUD (424–494).
- `lib/api/dev.ts` — `getTrace`, `getCoachLog`, `resetAccount`, `DevTrace`/`AiLogEntry` (rename
  `brokerSelect`→`scribeSelect` etc. here, coordinated with the backend rename).
- `lib/api/index.ts` re-exports everything, so existing `import { x } from '../../lib/api.ts'`
  call sites in every feature file need **zero changes** — this is a mechanical, low-risk split.

**Migration plan**
1. Create the new files, move code verbatim (no logic changes), re-export from `index.ts`.
2. Confirm `tsc --noEmit` is clean (mechanical move only).
3. Add `lib/api/http.test.ts` (headers() dev vs. bearer branching) and
   `lib/api/coach.test.ts` (SSE parsing: `[DONE]`, control-frame skip, dropped-stream case) —
   these are the two highest-value, lowest-effort tests in the whole package (see §6 test list).
4. Coordinate the `Broker`→`Scribe` field rename with `apps/cadence-api` (`services/dev-trace.ts`
   et al.) and `packages/cadence-shared` in the same PR, updating `DevPanel.tsx` alongside.

**Test-first requirements:** `headers()`/`isDevMode()` branching and the SSE parser, before the
file split (they're the parts most likely to regress silently).

**Dependencies/blockers:** the `Broker`→`Scribe` rename needs backend + shared-package
coordination (cross-boundary, see §5); the pure module split does not.

**Priority:** P1 · **Effort:** M (0.5–2 days for the mechanical split + first two test files;
the rename is a separate S effort once coordinated) · **Risk:** Low (mechanical move + additive
tests).

---

### P1 — `src/features/plan/OccurrenceSheet.tsx` (487 lines)

**Current problems**
- One component renders **five different domains** behind one occurrence id: a prescribed
  session log (267–352), meal/nutrition logging with photo capture (353–478), weigh-in capture
  (479–500), a generic system check-off (501–502), and the nutrition "Baseline" moment + macro
  targets sub-flow (441–477 inside the meal branch). Five responsibilities in one 487-line file
  is a textbook SRP violation.
- 15 pieces of local state (98–113: `detail`, `state`, `logText`, `logBusy`, `logErr`, `weight`,
  `weightUnit`, `mealText`, `mealKind`, `mealBusy`, `meals`, `mealPhoto`, `day`, `confirming`,
  `daysLogged`) — most belong to the meal-logging sub-flow and would naturally live in their own
  hook/component.
- Free functions `qty` (16–25), `leftLine` (32–41), `macroLine` (44–53), `mealForNow` (56–59),
  `downscalePhoto` (66–85), and `isFoodRow` (29–30) are all pure and already well-isolated at
  module scope — good instinct, but none are exported/tested, and `downscalePhoto`'s
  canvas-resize math (1024px cap, JPEG q0.8) is exactly the kind of "looks simple, has an off-by-
  one" logic worth locking down with a test (even a jsdom/canvas-mocked one).
- Render body branches on **6 mutually exclusive states** (`loading`/`gone`/`error`/session-present/
  `isFoodRow`/weigh-in/system/default fallback, lines 272–507) inside one JSX tree — a `switch`-
  driven sub-component per branch would make each state's markup independently reviewable and
  testable.
- Zero tests despite handling money-adjacent (macro targets) and health-adjacent (weigh-in,
  nutrition) user input with several silent-catch error paths (`.catch(() => null)` at 115, 258).

**Proposed target design**
- `features/plan/occurrence/useOccurrenceDetail.ts` — owns `detail`/`state` + the initial fetch
  effect (232–247).
- `features/plan/occurrence/SessionLogPanel.tsx` — the `session` branch (304–352):
  blocks/items/video-links + `submitLog`.
- `features/plan/occurrence/MealLogPanel.tsx` + `useMealLog.ts` — everything currently in
  `mealText`/`mealPhoto`/`meals`/`day`/`confirming`/`daysLogged` plus `refreshDay`/`confirmMeal`/
  `pickPhoto`/`submitMeal`/`downscalePhoto`. This is the largest sub-extraction (~230 lines) and
  the highest-value one, since it's the most state-heavy branch.
- `features/plan/occurrence/BaselineReadPanel.tsx` + `useNutritionBaseline.ts` — the "Baseline
  moment" block (441–477): `fetchBaseline`/`applyTargets`/`targetsBusy`/`targetsSet`.
- `features/plan/occurrence/WeighInPanel.tsx` — the weigh-in branch (479–500).
- `OccurrenceSheet.tsx` becomes a thin dispatcher: fetch detail, pick which panel to render based
  on `isFoodRow`/`detail.kind`/title regex, ~80–100 lines.

**Migration plan**
1. Extract the pure formatters (`qty`/`leftLine`/`macroLine`/`mealForNow`/`downscalePhoto`) to
   `features/plan/occurrence/format.ts` with unit tests — zero behavior risk, immediate coverage.
2. Extract `WeighInPanel` (smallest, most isolated branch) as a proof of the pattern.
3. Extract `MealLogPanel`/`useMealLog` (largest, do this with the most care + a manual QA pass on
   photo capture + tap-to-confirm, since there's no test net yet).
4. Extract `BaselineReadPanel`/`SessionLogPanel` similarly.
5. Add `OccurrenceSheet.test.tsx` covering the dispatcher's branch selection (`isFoodRow`, weigh
   regex-match, `404`→`gone` mapping at line 242).

**Test-first requirements:** the pure formatters and the 404→"moved with your new plan" mapping
(240–243) — the latter is user-visible error copy that's easy to accidentally break during a
refactor.

**Dependencies/blockers:** none blocking; can proceed independently of the `ReviewScreen` and
`api.ts` work above.

**Priority:** P1 · **Effort:** L (>2 days given 5-way split + first tests) · **Risk:** Medium
(touches meal photo capture and weigh-in, both unrecoverable-if-broken user input paths — mitigate
with the formatter tests first and a manual QA pass per extracted panel).

---

### P1 — `src/features/today/TodayDashboard.tsx` (294 lines)

**Current problems**
- Component both fetches data (`getProgress`/`getNutritionDay`/`getRecentMeals`, 82–88) **and**
  contains business logic (`rank`, 57–62; `occMod`, 28; the `nutritionEngaged`/`targets` gating
  logic, 116–123) **and** a heavy render tree with 5 inline sub-components (`ModIcon` 31–53,
  `RhythmRow` 125–155, `DashCard` 157–243) — three responsibilities per the rubric's SRP
  criterion.
- `DashCard`'s 4-way kind switch (158–242: `consistency`/`count`/`latest_vs_target`/`countdown`)
  is **near-line-for-line duplicated** in `ProgressView.tsx`'s `Card` (59–122) — the `count` branch
  in particular (182–208 here vs. 73–98 there) is copy-pasted, including the `addFor`/`addLabel`/
  `submitAdd` goal-event state (78–102 here vs. 17–38 in `ProgressView.tsx`) driving it.
- `RhythmRow` (125–155) is near-duplicated by `PlanView.tsx`'s `Item` (104–132) — same
  check/skip/open occurrence-row shape, independently maintained in two files.
- Zero tests; this is the screen every user sees first after onboarding.

**Proposed target design**
- `components/ProgressCards.tsx` — export a single `<ProgressCardView card={c} onAddEvent={...}
  addState={...} />` consumed by both `TodayDashboard` and `ProgressView`, collapsing the
  duplicated `count`/`latest_vs_target`/`countdown`/`consistency` branches into one place.
- `components/OccurrenceRow.tsx` — export the shared check/skip/open row, parameterized by
  `variant: 'dashboard' | 'week'` for the one visual difference (the module-icon badge that
  `RhythmRow` has and `Item` doesn't).
- `features/today/useGoalEventAdd.ts` — the `addFor`/`addLabel`/`busy`/`submitAdd` pattern,
  shared by `TodayDashboard` and `ProgressView`.
- `features/today/rank.ts` — pure `rank(card)` sort function, exported + tested.
- `TodayDashboard.tsx` shrinks to the data-fetch effect + composition of the above (~120–150
  lines).

**Migration plan**
1. Write snapshot/behavior tests against **today's** `DashCard`/`Card`/`RhythmRow`/`Item` output
   first (this locks current behavior before consolidating two independently-drifted
   implementations — check whether they've actually diverged in any edge case before merging them).
2. Extract `rank.ts` and `useGoalEventAdd.ts` (pure/isolated, no JSX risk).
3. Extract `ProgressCards.tsx`, rewire both `TodayDashboard` and `ProgressView` to use it, confirm
   the snapshot tests from step 1 still pass for both call sites.
4. Extract `OccurrenceRow.tsx`, rewire `TodayDashboard` and `PlanView`.

**Test-first requirements:** snapshot the 4 card kinds and the occurrence row **before** touching
anything — since the two implementations may have already silently drifted, this is the only way
to know whether consolidation changes visible behavior.

**Dependencies/blockers:** should land before or alongside the `ProgressView.tsx` and
`PlanView.tsx` P2 items below, since all three share the extraction targets.

**Priority:** P1 · **Effort:** M (0.5–2 days) · **Risk:** Low-Medium (mitigated by snapshotting
first).

---

### P2 files (150–300 lines, moderate duplication/coupling — condensed plans)

**`src/features/plan/PlanView.tsx` (230 lines).** Owns plan fetch, occurrence check/skip mutation,
proposal accept/dismiss, and hosts 3 sheets (`OccurrenceSheet`/`AdjustSheet`, plus routes to
`TodayDashboard`). Its `Item` component (104–132) duplicates `TodayDashboard`'s `RhythmRow` — see
the P1 `TodayDashboard` plan above for the shared fix. Beyond that, the component is reasonably
cohesive (one screen, one data source). *Effort: S once the shared `OccurrenceRow` lands · Risk:
Low.*

**`src/features/progress/ProgressView.tsx` (156 lines).** `Card` (59–122) and the
`addFor`/`addLabel`/`submitAdd` block (17–38) duplicate `TodayDashboard` — see the P1 plan above;
this file's own fix is "consume `ProgressCards.tsx` + `useGoalEventAdd.ts`" and shrinks to ~60–70
lines. No tests today on a tab every user with progress data visits. *Effort: S (paired with the
`TodayDashboard` work) · Risk: Low.*

**`src/features/settings/SettingsSheet.tsx` (214 lines).** `NutritionTargets` (18–106) is a fully
self-contained sub-feature (own fetch, own save/clear, own busy/note state) already correctly
scoped as a nested function component — extracting it to
`features/settings/NutritionTargets.tsx` is a pure file-move with no logic risk and improves
discoverability. The danger-zone "start over" flow (142–158, 196–225) mixes dev-mode
(`resetAccount`) and real-auth (`deleteMyData`) paths inline; both are business-critical
(irreversible data deletion) and untested. *Proposed: move `NutritionTargets` to its own file;
add a test for the `startOver()` phrase-gate (`phrase.trim().toLowerCase() !== 'start over'`,
143) and the dev-vs-real-auth branch. Effort: S · Risk: Low (mechanical + additive tests).*

**`src/features/onboarding/OnboardingChat.tsx` (231 lines).** Cohesive single-responsibility
component (the coach chat), but owns genuinely subtle async logic with zero tests: SSE-drop
recovery (`recoverFromServer`, 99–115, polls up to 6× at 800ms), the "stale thread" restore-vs-
fresh-greeting branch (64–85), and the pure-update StrictMode-double-invoke fix noted in the
comment at 135–136 (a bug class that already bit this file once). *Proposed: extract
`recoverFromServer`/`fillLastCoach`/the streaming-delta reducer into a `useCoachChat.ts` hook so
the reconnect logic can be tested without mounting the chrome-switching JSX. Effort: M · Risk:
Low-Medium (subtle timing logic — test the reducer in isolation before touching the component).*

**`src/features/auth/AuthScreen.tsx` (130 lines).** Cohesive and reasonably small, but it's the
literal front door of the app (Google OAuth + email/password sign-in/sign-up) with zero tests and
no loading-state gap analysis performed here beyond a manual read. *Proposed: add a test for the
`mode` toggle and the `!data.session` → "check your email" branch (63–66). Effort: S · Risk: Low.*

**`src/App.tsx` (113 lines).** The screen-state-machine (`Screen = 'loading'|'welcome'|
'onboarding'|'review'|'plan'`, driven by `getPlan().then(p => ...)` at 46–51) is the top-level
router for the whole app and has zero tests. It's small and clear today, but any future screen
addition (e.g. a `detours`/check-in screen — see §5) will grow this `if/else if` chain; consider a
small lookup table (`Record<PlanStage, Screen>`) now while it's cheap. *Effort: S · Risk: Low.*

**`src/styles.css` (527 lines).** One global, unscoped stylesheet for every component in the
package (BEM-ish class names like `.wiz-card`, `.prog-card`, `.sheet-*` with no CSS Modules/
scoping). Not a behavioral bug today, but at 527 lines and growing 1:1 with every new feature,
class-name collisions become a matter of when, not if, especially once a second contributor
joins. *Proposed: no urgent action, but plan a CSS Modules (or Tailwind, matching `frontend/`'s
stack — see §5) migration before the file crosses ~800–1000 lines. Effort: L (full migration) ·
Risk: Low if done incrementally per-feature.*

**`src/lib/capability/index.ts` + `web.ts` (34 + 31 lines).** See §1 and the capability-seam
recommendation in §6 — not a size problem, but a correctness/dead-code problem (unused seam;
`MicButton` bypasses it). *Effort: M to wire up · Risk: Low.*

**`src/components/MicButton.tsx` (100 lines).** Well-written in isolation (feature-detected,
correct composition-vs-append fix documented in its own comment block, 8–11), but it is the one
place in this codebase that talks to a browser-native-adjacent API (`SpeechRecognition`) *outside*
the capability seam. *Proposed: add a `dictation` capability to `Capabilities` (index.ts) with a
`web.ts` implementation that wraps today's `MicButton` logic, so a future Capacitor `native.ts`
capability file can swap in real STT without touching `MicButton.tsx`'s call sites. Effort: M ·
Risk: Low (additive; today's behavior is preserved by the web implementation).*

### P3 — condensed list (naming drift, dead code, minor style; no action urgency)

- `src/components/Orb.tsx`, `PhoneFrame.tsx`, `Stepper.tsx` — small, cohesive, well-commented;
  no changes recommended.
- `src/components/viz.tsx` (131) — pure, well-isolated presentational primitives; good first
  target for cheap snapshot tests (no logic risk) once test infra exists.
- `src/features/welcome/Welcome.tsx`, `MainTabs.tsx`, `AdjustSheet.tsx` — cohesive, single
  responsibility, no split needed.
- `src/features/dev/DevPanel.tsx`, `AccountSwitcher.tsx` — dev-only tooling (gated behind
  `?dev=1`); fine as-is except the `Broker` naming in `DevPanel.tsx` (see §4).
- `src/lib/supabase.ts`, `main.tsx`, `vite-env.d.ts` — trivial, no action.
- Minor: `ReviewScreen.tsx`'s `TYPE_LABELS` (59–63) never surfaces the canonical word "Ongoing"
  for `recurring` goals (only its description, "Something you keep doing") — not a violation
  (BRAND.md's label *is* the description), but worth a note if a future design pass wants the
  mechanism word visible too.

## 4. Brand & nomenclature audit

Scanned every `.tsx`/`.ts` file's rendered JSX strings against `docs/cadence/BRAND.md`'s
nomenclature table and banned-words list. **Overall compliance is strong** — canonical/user-facing
separation is respected everywhere checked: `equipment`→"Tools" (`ReviewScreen.tsx:29,81-92,601`),
`constraints`→"What we work around" (`ReviewScreen.tsx:576,595`), `plan.status`-adjacent
copy→"Set your rhythm" (`ReviewScreen.tsx:29,620,663`, `Stepper.tsx:3`), consistency phrased as
"showed up X of Y days" with no streak-reset language (`TodayDashboard.tsx:168,178`,
`PlanView.tsx:183-184`, `ProgressView.tsx:119`), no red/scoreboard framing anywhere in the
reviewed copy, and no literal "captured" in any user-visible string (all hits are code comments
or the `captured`/`setCaptured` variable name in `OnboardingChat.tsx`, which is never rendered
verbatim — the rendered copy at line 237 says `"{captured === 1 ? 'goal' : 'goals'} · Review →"`,
i.e. a plain count, not the word "captured").

Two real findings, both confined to the dev-only `?dev=1` surface (not visible to real users):

| # | File:line | Offending text | Issue | Suggested fix |
|---|---|---|---|---|
| 1 | `src/features/dev/DevPanel.tsx:133` | `"4 · Broker responses"` | Pre-rename name. BRAND.md: *"Broker (capture AI) → Scribe ... not surfaced"* | `"4 · Scribe responses"` |
| 2 | `src/lib/api.ts:508-509` | `brokerSelect?: {...}`, `brokerSummarize?: {...}` (exported `DevTrace` interface fields, also read at `DevPanel.tsx:135,137,143-147`) | Same pre-rename name, baked into an exported type other files already consume | Rename to `scribeSelect`/`scribeSummarize`, coordinated with `apps/cadence-api`'s `services/dev-trace.ts` and `packages/cadence-shared` (both use the same `Broker` name — see §5) |

Neither is user-facing today (both live behind the `?dev=1` query param and the 🛠 X-ray toggle,
which only renders when `isDevMode()` is true — see `App.tsx:79-90`), which is why these are rated
P1 rather than P0 despite matching the P0 rubric language ("nomenclature violation baked into a
data-model-adjacent field name that would be a breaking change later") — fix now while the blast
radius is one dev tool, not after more code depends on the `Broker` name.

**Not flagged as violations** (checked and found compliant / out of scope for a hard flag):
- `ReviewScreen.tsx`'s `GOAL_AREAS`/`AREA_LABELS` (51–57, 373) show the raw area words
  ("Movement"/"Nourishment"/"Mind"/"Practice") as `<select>` options in an editing UI. BRAND.md's
  "copy names the goal, not the area" rule is about narrative/marketing copy; a settings dropdown
  that must let the user *categorize* a goal is a defensible exception, not a violation — flagged
  here only as a watch-item if a future design pass wants to soften it (e.g. with a helper caption).
- `unlocks` in a code comment (`SettingsSheet.tsx:319`, `"the user's own tap; unlocks 'left' +
  rings"`) — banned-word list targets *user-facing copy*; this is an internal comment, not
  rendered text. No action needed.
- The **`detours`/`recap`** concepts from BRAND.md have **no corresponding UI anywhere in
  `apps/cadence-web`** — not a copy violation (there's no copy to be wrong), but a coverage gap:
  the `DisruptedEpisode` type already exists in `packages/cadence-shared/src/index.ts:428-459`
  with no consuming screen in this package. Noted here and in §5 since it affects how much brand
  surface area is actually shipped vs. specified.

## 5. Cross-boundary duplication flags

| Area | Files | Description |
|---|---|---|
| Response-shape duplication | `apps/cadence-web/src/lib/api.ts` (`ReviewData` 137-145, `PlanViewData`/`PlanDay`/`PlanOccurrence`/`PlanActivity` 148-186, `OccurrenceDetail` 199-212, `Meal`/`MealMacros`/`NutritionDayData` 266-296, `DevTrace`/`AiLogEntry` 497-538) vs. `packages/cadence-shared/src/index.ts` (`Occurrence`, `OccurrenceLog`, `OccurrenceSession`, `Macros`, `NutritionLog`, `ProgressCard`) | The client hand-declares its own response-shape interfaces instead of importing/extending the shared domain types, even where the shapes overlap closely (e.g. `MealMacros` vs. `Macros`). There's no shared *wire-contract* package the backend routes and this client both import, so a backend response change (e.g. in `apps/cadence-api/src/routes/plan.ts` or `routes/nutrition.ts`) can silently diverge from `lib/api.ts`'s hand-maintained types with no compiler catch — only a runtime `undefined` deep in a component. |
| `Broker` naming drift | `apps/cadence-web/src/lib/api.ts:508-509`, `src/features/dev/DevPanel.tsx:133-150` **+** `apps/cadence-api/src/services/dev-trace.ts` and ~18 other backend files (grep-confirmed) **+** `packages/cadence-shared/src/index.ts:1-6,124,477` (module-level JSDoc still titled *"§C4 Broker job contracts"*) | The BRAND.md-mandated `Broker`→`Scribe` rename (dated 2026-07-04) hasn't propagated to **any** of the three packages that reference the concept. A single coordinated rename PR is needed across `packages/cadence-shared`, `apps/cadence-api`, and this package's `lib/api.ts`/`DevPanel.tsx` — the longer this waits, the more call sites accrue. |
| Missing test-pattern parity | `apps/cadence-web/src/lib/api.ts` (0 tests) vs. `frontend/src/services/api.ts` + `frontend/src/services/api.test.ts` (AI Admin's equivalent client, tested) | The sister product in this monorepo already has an established pattern for testing its API client layer. `apps/cadence-web/src/lib/api.ts` is larger (497 vs. checked) and arguably higher-risk (streaming SSE parsing, financial/health-adjacent nutrition writes) yet has no equivalent. Reuse the AI Admin pattern rather than inventing a new one. |
| CI/workspace exclusion | Root `package.json:5-11` workspaces list (`backend`, `frontend`, `packages/types`, `packages/client`, `packages/edge`) | Confirmed by direct read: **none** of `apps/cadence-api`, `apps/cadence-web`, or `packages/cadence-shared` are root npm workspaces. Root `ci`/`typecheck`/`lint`/`test`/`prepush` (package.json:28-29) touch zero Cadence code. `apps/cadence-web` and `apps/cadence-api` each have their own `typecheck`/`test` scripts, but nothing invokes them automatically pre-merge. This is the single most important systemic gap in this audit slice (see §6 #6). |
| Unshipped brand surface | `packages/cadence-shared/src/index.ts:428-459` (`DisruptedEpisode`, canonical `detours` concept) | No screen in `apps/cadence-web` renders or edits a "detour" — the type exists, nothing consumes it here. Not a bug, but worth the supervising agent knowing the feature is spec'd + typed but 0% shipped on the web client. |
| Capability seam vs. `frontend/` | `apps/cadence-web/src/lib/capability/` | AI Admin's `frontend/` has no native-wrapper story (it's not the mobile-native product), so there's no equivalent seam to compare against there — this is Cadence-specific infrastructure. Flagged here only to note it's **entirely unused** (see §1, §3's `MicButton` plan) rather than to compare against `frontend/`. |

## 6. Systemic / cross-cutting recommendations

**First 10 tests to write (in priority order), once a test harness exists:**

0. **Set up the harness first**: `vitest` + `@testing-library/react` + `jsdom`, mirroring
   `apps/cadence-api`'s existing `vitest` setup (it already has `"test": "vitest run"` and a
   `engines.test.ts`) so the tooling choice is consistent across both Cadence packages.
1. `lib/api/http.ts` (post-split) — `headers()`'s dev-mode vs. bearer-token branching and
   `isDevMode()`'s URL-param parsing. Pure, zero-mock, highest ratio of confidence-gained to
   effort-spent.
2. `lib/api/coach.ts` — `sendCoachMessage`'s SSE frame parser: `[DONE]` termination, control-frame
   skip (`message.complete`/`v2.response.created`), and the "stream ends without `[DONE]`" →
   `completed: false` path. This exact logic already caused one shipped bug (per its own comment).
3. `features/review/unitConversion.ts` (post-extraction) — kg↔lbs and cm↔ft/in round-trips plus
   the `plausibleKg` 20–500 clamp, which guards a previously-shipped data-corruption bug.
4. `features/review/groupByGoal.ts` (post-extraction) — grouping + `__foundations__` sort order.
5. `ReviewScreen`'s commit flow (`doPreview`/`doConfirmLock`/`recoverIfAlreadyCommitted`) with a
   mocked `lib/api.ts` — the single most business-critical path in the product (plan commit) has
   zero coverage today.
6. `OccurrenceSheet`'s pure formatters (`qty`/`leftLine`/`macroLine`/`mealForNow`) — zero-risk,
   immediate coverage of nutrition-display formatting.
7. `OccurrenceSheet`'s `404` → `"gone"` state mapping and its user-visible copy — easy to
   accidentally break during the P1 split proposed in §3.
8. `OnboardingChat`'s `recoverFromServer` reconnect logic (post-extraction to `useCoachChat.ts`) —
   subtle polling/timing logic with a documented history of bugs (the StrictMode double-invoke
   fix noted in its own comment).
9. `TodayDashboard`/`ProgressView`'s `rank()` sort function and a snapshot of the 4 card kinds
   **before** consolidating them into `ProgressCards.tsx` (locks current behavior during the
   merge).
10. `App.tsx`'s screen-state-machine (`plan.stage` → `Screen` mapping) — the top-level router,
    cheap to test, and where regressions would be most visible (wrong screen on load for every
    user).

**TanStack Query adoption.** At least 6 components independently hand-roll
`useEffect(() => { getX().then(setX) }, [dep])` (`TodayDashboard`, `ProgressView`, `PlanView`,
`OccurrenceSheet`, `SettingsSheet`'s `NutritionTargets`, `OnboardingChat`), and the nutrition-day
fetch specifically is triplicated across three of them with no shared cache. `PlanView`'s manual
`reloadKey: number` prop-drilled into `TodayDashboard`/`OccurrenceSheet` (declared at
`PlanView.tsx:33`, bumped via `bump()` at 40, threaded through `onLogged`/`onCommitted` callbacks)
is a hand-rolled substitute for `queryClient.invalidateQueries()`. Adopting TanStack Query would:
replace the `reloadKey` mechanism entirely; deduplicate the nutrition-day fetch into one cached
query key consumed by all three call sites; replace the repeated hand-rolled
`'loading'|'ready'|'gone'|'error'` state unions (`OccurrenceSheet`) with the library's built-in
status; and give free request deduplication when a user rapidly switches tabs.

**Capability-seam hardening.** Wire up the currently-dead `lib/capability/` seam: (1) add a
`dictation` capability and move `MicButton`'s direct `SpeechRecognition` access behind it, so a
future Capacitor build gets native STT instead of the feature silently disappearing; (2) add a
small `CapabilitiesProvider`/`useCapabilities()` context at the `App.tsx` root so features consume
capabilities instead of importing `webCapabilities` directly (today nothing imports it at all —
confirmed via repo-wide grep); (3) consider a lint rule or file-header convention flagging direct
`navigator.*`/browser-only global access inside `features/**` outside of designated seam
boundaries, to stop this gap from recurring as new native-adjacent features (photo capture,
geolocation) are added.

**Wire Cadence into root CI.** Add `apps/cadence-web`, `apps/cadence-api`, and
`packages/cadence-shared` to root `package.json`'s `workspaces` array, and chain their
`typecheck`/`test` scripts into the root `ci`/`prepush` scripts (mirroring how `backend`/
`frontend` are chained today at `package.json:28-29`). This is the highest-leverage single change
available: it costs almost nothing and immediately closes the "a broken Cadence PR merges clean"
gap called out in §1.

**Split `lib/api.ts` and extract the duplicated dashboard-card/occurrence-row rendering** as
detailed in §3 — both are mechanical, low-risk, and pay down real duplication (roughly 150+ lines
of near-identical JSX/logic across `TodayDashboard`/`ProgressView`/`PlanView`) before the pattern
gets copied a third time into a not-yet-built screen.
