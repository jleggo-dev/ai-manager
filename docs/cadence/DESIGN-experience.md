# Experience — the record that only grows

**Opened 2026-09-07. Status: PROPOSAL — awaiting owner rulings (§9).**
Owner ask: *"Experience is a wonky feature right now… it doesn't really make sense. Propose a new
experience points system — it should be something that eventually can get us rewards."*
Read first: [BRAND.md](BRAND.md), [PLAN.md](PLAN.md) §A12, [REQ8](REQ8-task-walkthrough-and-tools.md) §5.

---

## 1. Why it's wonky today

The number on Today and Progress is `doneCount * 10` — a client-side count of `done` rows in the
7-day view window, times ten (`apps/cadence-web/src/features/plan/PlanView.tsx:253`,
`features/progress/ProgressView.tsx:33`). Because the window rolls, the number **goes down** as
good days age out, which is the one thing the brand says a counter must never do. The walkthrough
promises "Finish · +10 XP" (`features/walkthrough/Recap.tsx:202`) but nothing is awarded: the
points engine (`apps/cadence-api/src/services/points.ts`, migration `0020_points_state.sql`) has
rules, tests and a live column, and no caller — REQ8 §7 parked the finalize. So the user sees a
number that is not the wallet, not the streak, and not consistency, and no one can say what it means.

## 2. Principles, and the "not a game" tension

1. **Never shames.** No event ever subtracts because of something that happened to you.
2. **Never resets.** Lifetime experience is monotonic. A balance can fall only because you chose
   to spend it.
3. **Means one thing.** It is a *record of what you did*, weighted by what it took — never a rank,
   never a target, never compared to anyone.
4. **Reads as "what happened".** Every unit traces to a line in the log: this session, this week,
   this milestone. If it can't be shown as a receipt line, it isn't earned.

`cadence-brand-identity-v2.md` §8 says *"Not a game. Progress is visible without points, confetti,
or XP."* The owner's own A12 line is sharper: *a number on the home screen is a scoreboard whatever
its rules are.* Both are right, and the fix is placement, not abolition. **Recommendation (a):
experience comes off the Today header entirely** — the ⭐ pill goes; the streak flame stays per
Req 4 — and lives in three places only: **Progress** (where records live), **the receipt after a
thing is done** (walkthrough finish, week-review confirm), and **the coach's mouth** at moments
that earn it. A number you look up is a record; a number that watches you is a score. The brand
line should be amended to *"Progress is visible without a score on the home screen"* — the ledger
below is an honest log with a total, and that is how it must always read.

## 3. The recommended system

### 3a. One story, three views

| View | Question it answers | Can it fall? | Who quotes it |
| --- | --- | --- | --- |
| **Consistency** `5 of 7` (`metrics.ts`) | How did I show up this week? | dips, never resets | the coach, every check-in and every re-plan — it is the planning signal (A12) |
| **Streak** (`streak.ts`) | How long is the current run? | ends when freezes are gone and the slip was silent (Req 4) | the coach only after a freeze saved it or at a round number; never when it ends — she checks in instead |
| **Experience** (this doc) | What have I put in, all told? | never | the coach at a tier change or when a reward is claimable; the Progress page always |

This settles A12's contradiction on purpose: **the streak can end** — that is what makes freezes an
economy — and CLAUDE.md's ban is read as written: never *because life happened*, which detours,
check-ins and episodes already shield. Experience is the thing that never resets, and it is
the wrong number for the home screen for that very reason: it can only ever look like a score.

### 3b. What earns it

Every entry is keyed on something the log already knows. The 9,000-step day vs the 50 km is
answered by the bottom two rows: a big day is a session (≤30); finishing the goal is 500.

| Event kind | Weight | Source of truth | vs `points.ts` |
| --- | --- | --- | --- |
| `session` — a movement/mind/practice occurrence done | 10 + 1 per 10 logged minutes, minute credit capped at +20 (max 30) | `session-log.ts`, `adhoc-log.ts` | keeps `perTask: 10`; folds the weekly-minutes lump into the session line so it fits on a receipt |
| `meal` — a nourishment occurrence logged | 4, max 12/day | same | new (10 per meal would let meals outweigh training) |
| `day_kept` — every due occurrence done | 20 | day finalize beside `advanceStreak` | keeps `dayCompleteBonus` |
| `check_in` — week review confirmed | 15, any numbers | `POST /plan/week/confirm` | new — looking honestly at the week counts |
| `week_kept` — consistency ≥ 5 of 7 scheduled days at confirm | 50 | same | new |
| `correction` — a review edit that **lowers** the record | 5 | `week-review-write.ts` | new; upward edits earn the session's own credit, never a bonus |
| `detour` — a detour or pause entered instead of a silent gap | 20, once per episode | `episodes.ts` insert | new — telling the coach life happened is the behaviour we most want |
| `milestone` — a `GoalMilestone` marked done | 100 | goals | new |
| `goal_reached` — a milestone/target goal completed | 500 | `goal-events.ts` completion | new |
| *streak day bonus* | **dropped** | — | it triple-counts kept days and makes a streak's end a financial loss — loss-framing by another door |

**Caps:** 100/day and 500/week from `session` + `meal` + `day_kept`; milestone and goal events
sit outside the caps. Minute credit counts logged minutes up to 3× prescribed (or 180). A
consistent person earns ~250/week; a patchy one ~120.

### 3c. Ladder

Lifetime only. A tier is a name for how long you've been keeping a rhythm, never a gate.

| Tier | At | A consistent person gets there in |
| --- | --- | --- |
| Getting going | 0 | day one |
| Finding a rhythm | 1,500 | ~6 weeks |
| Keeping time | 5,000 | ~5 months |
| In stride | 12,000 | ~1 year |
| Second nature | 30,000 | ~2½ years |
| Well worn | 60,000 | ~5 years |

### 3d. Rewards, in phases

**Phase 1 — freezes (built, retune).** `redeemFreeze` stays; cost **200**, not 100. The streak
already earns one freeze per 7 kept days (`DEFAULT_STREAK_PARAMS`); a bought freeze should cost
about a consistent week, or buying always beats earning. Balance falls, lifetime doesn't. Copy:
"You've got enough put by for a freeze — want it banked?" — never "spend".

**Phase 2 — things the coach grants at a tier, free.** A second coach portrait (Finding a
rhythm), a custom activity slot (Keeping time), a printable/shareable season recap (In stride).
Granted, not bought: a cosmetics shop is the Duolingo pattern §8 rejects. *Flag:* "a longer horizon
by default" conflicts with the `DEFAULT_HORIZON_DAYS = 7` ruling (DESIGN-check-in §2); offer a
14-day *view* with the weekly check-in unchanged, or drop it.

**Phase 3 — external (partner discounts, gear, charity).** Honest only if the data model already
has: an append-only ledger with a `source` per line; compensating `void` entries, never edits;
server-only writes; a `redemptions` table with terms version, fulfilment status and an audit
column; an anomaly flag (cap-hit days, only-upward corrections, minutes far past prescription);
and terms in `docs/cadence/legal` (no cash value, non-transferable, withdrawable). Start with
**charity donations at Keeping time** — nothing to fulfil, and nothing to gain by gaming.

### 3e. Anti-gaming

Awards are computed server-side from rows that were due (or an ad-hoc log), never from the client.
Caps bound a day of fake taps to 100. A downward correction voids the session's line; a session
logged for a day older than the confirmed week earns nothing. Until Phase 3 the number buys only a
freeze, which is the real defence: there is nothing worth cheating for. Phase 3 adds account age ≥
Keeping time, no open anomaly flag, and a human look above a threshold.

## 4. Data model and API

**`cadence.experience_events` — append-only.** Justified over extending the jsonb fold because
receipts need line items, corrections need compensating entries, and Phase 3 needs an audit trail;
a watermark fold can't do any of the three.

```sql
create table cadence.experience_events (
  event_id     uuid primary key default gen_random_uuid(),
  user_id      uuid not null references cadence.users(id),
  kind         text not null,          -- session|meal|day_kept|check_in|week_kept|correction|detour|milestone|goal_reached|redeem|void|backfill
  amount       int  not null,          -- + earns, − redeem/void
  source_kind  text, source_id text,   -- occurrence_id / episode_id / goal_id / plan week
  occurred_on  date not null,          -- the user's day; caps key on it
  voids        uuid references cadence.experience_events(event_id),
  created_at   timestamptz not null default now(),
  unique (user_id, kind, source_kind, source_id)   -- idempotent by construction
);
```

`users.points_state` stays as the **rollup cache** `{balance, lifetime, last_evaluated}` — the
column name is boring and never needs to change; `last_evaluated` still drives the day-finalized
kinds (`day_kept`) forward-only, exactly like the streak. Existing users: the finalize never ran,
so every row should still be the 0020 default — verify with one SELECT, then **backfill** one
`session` line per done occurrence in the last 60 days (kind `backfill`, no day/week bonuses) so
testers don't restart at zero.

`ExperienceView` on the plan response replaces `doneCount * 10`:
`{ lifetime, balance, tier: { name, index, next_at }, this_week, freeze_cost, can_redeem_freeze }`.
Routes: `POST /plan/rewards/freeze`; `GET /progress/experience?limit=` for the receipt list.

## 5. Where it shows

| Surface | Today | Proposed |
| --- | --- | --- |
| Today header (`TrailHeader.tsx`) | ⭐ pill | **dropped**; flame stays |
| Progress (`ProgressView.tsx` StreakLine) | "N XP" | second quiet line "Finding a rhythm · 2,140 experience", tap → the receipt list (last 10 lines) |
| Walkthrough (`Recap.tsx`) | "Finish · +10 XP" | button "Finish"; the log line reads "Logged · 42 min · +30 experience" **from the server response**, never predicted |
| Week-review receipt (`confirm-copy.ts`) | "Week confirmed — 5 of 5 sessions · 20 of 21 meals · 1 correction" | "… · 1 correction · +65 experience" |
| Coach context (`date-context.ts` daily stamp) | — | one line: "Experience 2,140 — Finding a rhythm, 360 to Keeping time. Freezes: 1 banked, 1 affordable." She mentions it at a tier change or a claimable reward; otherwise silent |
| Notifications | — | **none, ever.** `freeze_save` stays the only reward-adjacent push. A tier is said in conversation, not buzzed |

## 6. Naming

User-facing: **"experience"** — the owner's word, and the honest one: experience is something you
*have*, not a score you *get*, and nobody has a bad amount of it. Never "XP", never "points" in
copy. Canonical: `experience` (`experience_events`, `ExperienceView`, kind names above);
`points_state` keeps its name as the cache column per the nomenclature rule.

## 7. Alternatives considered

**Finish the fold as designed** (`advancePoints` + `pointsForWeekMinutes` into `points_state`).
Cheapest path and the tests exist. Rejected: a watermark fold has no line items, so the receipt
can't say what a number was for; a correction can't void one session without re-deriving the day;
and the weekly-minutes lump lands as an unexplained jump at the week boundary. Phase 3 would then
need the ledger anyway, on top of a wallet nobody can audit.

**No number — tiers only, derived from consistency history.** Closest to "not a game". Rejected:
the owner wants rewards, and a reward needs something spendable and auditable; a tier with no
visible progress is opaque ("why am I not Keeping time yet?"); and the 9,000-steps-vs-50 km
distinction has no home when the only input is kept days.

## 8. A12's questions, answered

| Question | Answer |
| --- | --- |
| What earns, at what weight? | §3b; a session ≤30, a finished goal 500 |
| Monotonic? | Lifetime yes. Balance falls only by choice (freeze, Phase 3) |
| What IS the number, and can it live on the home screen? | Today: done rows × 10 in a rolling window. Proposed: a ledger total, and no |
| How do experience, streak and consistency relate? | §3a: record / momentum / honesty; the coach quotes consistency for planning, streak after a save, experience at a tier |

## 9. Open questions for the owner

1. Drop the ⭐ pill from the Today header (streak flame stays)? — yes / no
2. Freeze cost 200 (about a consistent week)? — a number
3. "experience" as the user-facing word, never "points"/"XP"? — yes / no
4. Backfill 60 days of done sessions for existing testers? — yes / no
5. First external reward = charity donation at Keeping time? — yes / no

## 10. Build plan

**Phase 1 — one PR.** `migrations/cadence/0059_experience_events.sql` (0058 is taken by the
in-flight `plan_week_started_at`);
`packages/cadence-shared/src/types/rewards.ts` (`ExperienceView`, `ExperienceEventKind`);
`apps/cadence-api/src/services/experience.ts` (weights, caps, tiers — pure, tabled like
`points.test.ts`; keeps `redeemFreeze`, retires `pointsForWeekMinutes`/`streakDayBonus`);
`repos/experience-events.ts`; award hooks in `services/session-log.ts` and `adhoc-log.ts`;
`plan-view.ts` adds `experience`; `routes/plan.ts` redeem route; web: `PlanView.tsx`,
`TrailHeader.tsx` (pill out), `ProgressView.tsx`, `Recap.tsx`. Backfill script under
`apps/cadence-api/scripts/`.

**Phase 2.** `day_kept` beside `advanceStreak` in `streak.ts`; `check_in`/`week_kept`/`correction`
in `routes/week-review.ts` + `week-review-write.ts` + `confirm-copy.ts`; `detour` in the episodes
route; `milestone`/`goal_reached` in `goal-events.ts`; the `date-context.ts` line; the Progress
receipt list; tier grants (portrait, slot, recap).

**Phase 3.** `redemptions` table + anomaly flags; `docs/cadence/legal` terms; the first partner
or charity integration; a review queue.
