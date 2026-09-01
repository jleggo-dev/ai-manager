# Plan changes: every way a plan changes, what each may cost, and the fix suite

Owner directive (2026-08-31): **latency must be proportional to the size of the ask.** A
five-exercise tweak took 7+ minutes and failed; a full-week rebalance took 2h45m of retries. This
doc is the comprehensive evaluation that directive demanded: the complete inventory of plan-change
scenarios, a latency budget for each, the shared root causes, and the fixes in phases. It exists so
we fix the scenario space, not tonight's symptom.

Companion docs: [PLAN.md](PLAN.md) (living plan), [TOOL-HARNESS.md](TOOL-HARNESS.md) (tool rules).

## The incident that forced this (2026-08-31, all timings from production logs)

- "Add chest and abs to today's workout" → the manual Adjust button → full re-synthesis:
  4 concurrent per-goal `synthesize-plan` drafts (the user has 4 goals) + a reduce call.
- Individual `synthesize-plan` calls measured **242s–563s** (12–43K prompt / 1.5–27K completion
  tokens). Output volume IS the latency: the job emits the entire week as JSON, and 27K completion
  tokens at the observed 40–50 tok/s is minutes of pure generation. The relay adds variance
  (one 19K-prompt run finished in 56s; a same-shaped one took 242s).
- All four drafts died at ~302s: `apps/cadence-api/src/ai/aim.ts` sets **no fetch timeout**, so
  undici's default `headersTimeout` (300s) kills any un-streamed job response after 5 minutes —
  a job that runs longer is *undeliverable*, even when it succeeds.
- It DID succeed: the job layer failed over (300s primary timeout + fresh 300s failover budget)
  and wrote three finished drafts to `diagnostic_logs` at 418–445s total. Nobody was listening.
  No `pending_plan`, no push, no error. The sheet froze forever.
- The morning rebalance showed the second disease: **no in-flight guard** — synthesis re-fired in
  quadruplicate 8 times between 11:41 and 13:05; plan v17 landed at 14:26.
- The proof the fast path exists: the same morning, a chat turn using `propose_plan_change`
  (deterministic, no LLM in the edit path) put a proposal card up in **~20 seconds end-to-end**.

## The ladder: route by blast radius

| Rung | Ask | Mechanism | Budget |
|---|---|---|---|
| 0 | move / retime / resize / remove / add a commitment | `PlanEdit` grammar, deterministic (`plan-edit.ts`) | **< 2s** |
| 1 | change what's *inside* one session ("add chest and abs") | re-prescribe ONE occurrence with the user's words as steer | **< 45s** (one `prescribe-session`, ~34s measured) |
| 2 | reshape a few commitments | one small model call emitting `PlanEdit[]` + deterministic apply + proposal card | **< 30s** |
| 3 | rebuild / rebalance the week | evolve-mode synthesis, **diff output, no fan-out**, background + progress + push | **60–120s** |

Two structural rules fall out:

1. **Evolution ≠ genesis.** Fan-out (per-goal drafts + reduce) exists because a single
   genesis call juggling ≥2 goals dropped goals. An evolve has the current plan as its anchor —
   coverage by construction. Fan-out is for first-lock only.
2. **Emit the diff, not the week.** Evolve-mode `synthesize-plan` should return edits against the
   current plan (the `PlanEdit` grammar), composed and vetted deterministically. 1–2K output
   tokens instead of 12–27K turns the same model on the same relay from 5–9 min into 30–60s.

And their amplifier: `commitActivities` unconditionally wipes **every** future pending occurrence
(`plan-synthesis.ts` → `deleteFuturePendingOccurrences`) and re-warms the lot (~70 × ~34s ÷ 3
concurrency). Commit must invalidate only the occurrences of activities the diff touched.

## Scenario inventory (verified against code, 2026-08-31)

Every way a plan, its activities, its occurrences, or its sessions change. Grouped by weight.
"Blocking" = the client holds one HTTP request open for the whole thing.

### Synthesis-class (minutes today; the rows this doc exists for)

| Scenario | Trigger | Chain | LLM calls | Mode | Progress today | Failure today |
|---|---|---|---|---|---|---|
| First lock | onboarding "Build my week" | `POST /plan/lock` → `confirmLock` → inline `previewLock` → `planSynthesize` → `commitActivities` | N-goal fan-out + reduce + 1–3 vet + up to 2 repair synths | **Blocking** | orbiting mark + rotating copy + poll/resume/push (the hardened one) | error screen + retry |
| Adjust / rebalance sheet (also the coach's "Rebuild my plan" card — same sheet) | user steer or auto-start | `POST /plan/replan/preview` → `previewReplan` → `planSynthesize` → `setPendingPlan` → push | same fan-out set; **measured 271s @ 4 goals, 4–9 min lately** | **Blocking** | static mark + timed copy bands + elapsed clock | 500 misroutes to the veto branch; a >300s run is **undeliverable** (aim.ts has no timeout; undici kills at 300s) |
| Weekly proposal → Accept | banner tap | `POST /plan/proposal/accept` → `replanPlan` → synthesize+vet+**commit**, one shot | same fan-out set | **Blocking** | **a disabled button label** | generic error line; **no push, no recovery, no pending poll** |
| Confirm replan / apply change card with a missing `pending_plan` | race | `confirmPendingPlan` fallback runs a **full synthesis inline** | fan-out set | Blocking | button label | silent bulldozer — "apply my small edit" becomes a rebuild |

### Commit-class (seconds; deterministic, but with a structural amplifier)

| Scenario | Chain | Notes |
|---|---|---|
| "Make this my week" / apply change card | `POST /plan/replan` or `/plan/lock` → `commitActivities` | wipes **every** future pending occurrence + rematerializes + re-warms ~N sessions ×34s in `waitUntil` background (which dies at invocation end) |
| `build_next_week` (chat tool or end-of-trail button) | recommit of same activities, v+1 | zero LLM; same full wipe + re-warm; push on completion |
| `propose_plan_change` (chat) | deterministic `PlanEdit` apply → pending card | **the 20-second proof**; zero LLM in the edit path |
| `extend_horizon` (chat) | extend + materialize days | added days are never warmed — cold 34s taps |
| Menu save, weigh-in, adhoc/planned logs, week-review toggles | direct writes (+ `parse-session-log` where logging) | seconds |

### Detour-class

| Scenario | Chain | LLM calls | Mode |
|---|---|---|---|
| Enter (chat door) | post-stream `capture-detour` → `enterEpisode` → `disrupted-plan` | 2 sequential | after the reply; invisible until next `GET /plan` |
| Enter (banner / self-declare) | `POST /plan/episode` → `enterEpisode` | 1 | **Blocking**, no timeout, client swallows errors |
| Equipment revision (words / photo / chat) | `reviseEpisodeEquipment` (churn-guarded) | 1 / 2 / 2 | Blocking (photo: vision + draft) |
| End | restore + arm `rebaseline` proposal (≥7d) | 0 (but Accept later = full synthesis) | Blocking, fast |

Detour temp occurrences are **never warmed** — every detour session is a cold tap.

### Session-class

| Scenario | Chain | Notes |
|---|---|---|
| Warm on plan view / on commit | `prefetchImminentSessions`, concurrency 3, `waitUntil` | ~34s per session; may be truncated at invocation end; invisible in UI |
| First open of a cold occurrence | `GET /plan/occurrences/:id` → `generateSession` (up to 2 attempts) | blocking tap, ~30–60s, dots + narration |

### Automatic writers

Exactly one: `assessIfDue` (background on `GET /plan`, 7-day throttle) — writes a *proposal*
banner, never a plan. **No cron synthesizes or re-plans anywhere.**

## Guards that don't exist (the defect list behind the phases)

Server: no in-flight lock on any synthesis/commit path (double-tap = two versions, two wipes,
two warm fan-outs); `pending_plan` is one shared slot clobbered by three writers (first-lock
preview, replan preview, coach card); no timeout/abort/cancel on `synthesize-plan`
(`aim.ts` passes no signal — undici's 300s default is the only ceiling, and it *discards
successful failover work*); no retry on synth/vet; unbounded fan-out width (`Promise.all` over
goals); commit has no no-op detection (byte-identical commit still wipes + re-warms everything);
`assessIfDue` is racy; `runInBackground` (`waitUntil`) can truncate long warms.

Client (full list in the audit): proposal-banner Accept behind a bare button label;
Adjust sheet's `×` kills the recovery poll while the scrim pretends otherwise; a 500 from
preview skips the recovery poll (`res.ok` unchecked); warming sessions are invisible;
no ongoing indicator after a coach-initiated background action; push arrival is a dead end
(no payload, no tap handler, nothing refetches `/replan/pending`); detour entry/equipment/resume
failures are swallowed; auto-start can fire a redundant synthesis over an existing proposal.

## Progress: "an LLM in a harness" (owner requirement)

No plan-changing flow may show a bare spinner. Every flow surfaces, live:

- **which stage** it is in (reading your week → drafting → checking it → writing it down → warming
  sessions N of M);
- **what the model said** as soon as it exists (the synthesis `note`, the vet verdict, per-draft
  completions);
- **failure, explicitly** — a failed background run must produce a visible card/push inviting
  retry, never silence.

Chat already streams tokens + tool-activity lines; gaps there: activity frames are emitted only
*after* a tool executes, nothing covers the pre-first-token stretch, and background work the coach
kicks off ("the new week is being drawn up") has no ongoing indicator after the turn ends.
Token-level streaming out of AI Admin *jobs* is a bigger lift (streaming exists for chat only);
stage-level events are the honest v1 and land most of the felt difference.

## Fix suite, in phases

> Status: Phase 0 built 2026-08-31 (five parallel parcels: plan_run machinery + routes, aim-remote
> transport, detour warming, Adjust-flow client, PlanView/banner/detour client). Migration 0051
> applied to prod the same day. Merged as #334.
>
> Phase 1 built 2026-09-01 (three parcels: diff-output evolve via the new `evolve-plan` job with
> full-synthesis fallback on every dead end; `revise_session` drawer tool + `user_steer` on
> prescribe-session; diff-aware commit invalidation with anchor-parity gate and
> `CADENCE_COMMIT_DIFF=0` kill switch). Jobs synced live. **Measured on the owner's real 4-goal,
> 16-activity plan via scripts/probe-evolve-plan.ts:** the incident ask ("add chest and abs") =
> **47s, 1 edit, no fallback** (was 7+ min and failed); a whole-week rebalance steer = **263s,
> 4 edits, no fallback** (was 271s best-case single run, 2h45m with the retry storms). The
> remaining rung-3 gap to the 2-minute budget is model deliberation through the relay — the
> benchmark item below — not output volume. Phases 2–4 owed.

- **Phase 0 — delivery correctness (nothing may silently die):** explicit timeout in `aim.ts`
  sized above the job layer's worst case; synthesis runs move behind a durable `plan_run` record
  (running/stage/failed) — `POST /plan/replan/preview` and `POST /plan/proposal/accept` return
  202 and run in background, `GET /plan/replan/pending` reports proposal | running{stage} |
  failed, repeat taps join the running record instead of re-firing, failures persist AND push;
  the confirm-with-missing-pending fallback stops silently rebuilding (409 instead); evolve
  never fans out (fan-out is genesis-only, and capped); detour entry/equipment stop swallowing
  errors and detour occurrences get warmed; client reworked to the poll contract with real
  stage lines. First-lock keeps its hardened flow and inherits the aim timeout.
- **Phase 1 — proportional cost:** evolve = single call (no fan-out); evolve emits `PlanEdit[]`
  diffs (job prompt change → `sync-jobs.ts`); diff-aware commit invalidation; `prescribe-session`
  gains a `steer` and a one-session re-prescribe path (rung 1 — tonight's actual ask has no home
  today).
- **Phase 2 — routing:** the Adjust sheet's steer goes through the coach (she already triages
  correctly — deterministic card for small asks, synthesis only on explicit rebuilds), per the
  governing inversion: the coach is in control of the software.
- **Phase 3 — progress surfaces:** stage-event channel (persisted per plan run, polled or
  SSE), wired into the Adjust sheet, plan view, detour, check-in, and chat's background-work
  indicator; chat emits tool frames before execution as well as after.
- **Phase 4 — measurement:** per-scenario latency probes with budgets asserted
  (extend `scripts/probe-replan-preview.ts`); `ai_log` records duration on every kind; a
  standing query for the weekly latency picture, so regressions are seen before users feel them.

## Latency budgets (acceptance)

| Scenario | Today (measured) | Budget after |
|---|---|---|
| Session-content tweak | 7+ min, failed | < 45s foreground |
| Small plan edit (chat or sheet) | 20s chat / 8+ min sheet | < 30s everywhere |
| Whole-week rebalance | 8 min–2h45m, silent failures | < 2 min background, live progress, push |
| Detour | (being measured) | < 2 min background, live progress |
| First lock (genesis, fan-out allowed) | minutes, opaque | background + progress from day one |

No budget is met by hiding the wait: budgets count from tap to *the change visible on the plan*,
with progress the whole way.
