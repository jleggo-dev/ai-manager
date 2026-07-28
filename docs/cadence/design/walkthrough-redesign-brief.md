# Design brief — Task walkthrough v2 (navigation, sets, circuits, honest logging)

**Goal.** Redesign Cadence's full-screen task walkthrough so a person can move through a
workout **in both directions**, clearly log **what they actually did** (including partial reps
and circuits), and get an honest **end-of-workout recap**. This extends the original handoff,
whose walkthrough was a one-directional title → body → **Next** step-player.

## Read these first
- **Visual language + the original walkthrough design:**
  [`redesign-today-trail/README.md`](redesign-today-trail/README.md) — §4 "Task walkthrough",
  §3 "Task start sheet", plus the node / ring / pressable-disc system, the time-of-day tone ramp,
  and the design tokens. Screens: `redesign-today-trail/screens/05-walkthrough-step.png`,
  `06-celebration.png`, `04-start-sheet.png`.
- **The step→tool model the walkthrough projects from:**
  [`../REQ8-task-walkthrough-and-tools.md`](../REQ8-task-walkthrough-and-tools.md).
- **Brand + nomenclature:** [`../BRAND.md`](../BRAND.md) (coach, not a fitness app; "a rhythm you can keep").

## What exists in code today (the thing to redesign)
- **Full-screen player:** `apps/cadence-web/src/features/walkthrough/Walkthrough.tsx` — a control row
  (✕ + a thin progress bar), a centered step (eyebrow "STEP n OF m" + title + body + the step's tool),
  a "Next"/"Finish" CTA, a "Skip", then a confetti celebration whose "Continue" marks the task done.
- **Tools, one per step, rendered by kind:** `.../walkthrough/tools/registry.tsx`
  - `StepReps.tsx` — a **segmented ring that IS the sets**; "Set N of M" in the middle, "Done set" ticks a segment.
  - `StepCircuit.tsx` — a **ring that IS the rounds**; rotates the block's exercises ("Done → next").
  - `StepTimer.tsx` — a countdown that auto-advances.
- **The model these project from:** `packages/cadence-shared/src/walkthrough.ts` (the `StepTool` catalog,
  `WalkthroughStep`, `deriveWalkthrough`) over `packages/cadence-shared/src/types/occurrence.ts`
  (`SessionItem` = name / sets / reps / load / duration; `SessionBlock.mode` = `straight` | `circuit` + `rounds`).
- **Which tasks even open this:** `apps/cadence-web/src/features/plan/taskShape.ts` — only **session**-shape
  (multi-step workouts) use this player; **captures** (weigh-in, meals) and single-step **quick** tasks don't,
  and must never show "Start / I have less time".

## The problems to solve
1. **No back navigation.** Forward only. People want to click through to *preview* a whole workout, and to
   return to a step they didn't finish.
2. **"Next" is ambiguous — does it mark the step done?** It shouldn't. Navigating ≠ logging, but that isn't clear.
3. **Circuits aren't legible.** When a block is a circuit you can't tell you're *in* one, and there are two
   competing "advance" affordances: the in-circuit **"Done → next"** and the shell's **"Next"**.
4. **No partial logging.** Target is 15 reps, you did 10 — there's no way to record 10. We want the honest
   number; it is the coach's adaptation signal.
5. **No skip recap.** Finishing goes straight to confetti; it never reminds you of the steps you skipped.

## The model we think fixes it (please pressure-test, then design)
Separate three things the current player conflates:
- **Browse** — Back ↔ Next move freely through the guide and commit **nothing**.
- **Do** — the per-step tools capture what actually happened (tick sets **with an editable rep count**,
  run timers, rotate a circuit).
- **Commit** — the task is marked done only at the **end**, on an explicit Finish, after a **Recap**.

Specific asks:
- **Back / Next** as free navigation, with a clear signal that moving logs nothing.
- **Circuit step:** make "you're in a circuit" obvious (e.g. eyebrow **"CIRCUIT · ROUND 1 OF 2"**), and resolve
  the two advance buttons (e.g. the shell's Next becomes **"Skip circuit"** while the in-unit "Done → next" drives it).
- **Editable reps per set** — the prescribed number is a starting point you can dial to what you did → **"Log set"**.
- **End Recap** (replaces / precedes the celebration): what you did vs what you skipped, each skip offering
  *do now / mark done / leave it*, then **Finish** (+XP).
- Stay inside the handoff's system — discs, rings, tone ramp, oklch tokens, Fraunces/Nunito, pressable bottom edges.

## Constraints / don't break
- The **ring-as-sets** and **ring-as-rounds** motif just shipped and is deliberate — evolve it, don't discard it.
- **Straight vs circuit is the coach's choice** (block `mode`), not a user toggle.
- Whatever a step captures must reduce to a short log line (`sets×reps@load`, `rounds done`) — don't lose that signal.
- **Timer** steps auto-advance; other steps don't.

## Deliverables
Screens / states, with redlines in the handoff's format (oklch, sizes, spacing, radii, shadows):
a **reps step** with editable sets, a **circuit step** mid-round, the **back-navigation** affordance, and the
**end Recap** with skipped items. Note any nomenclature changes you'd make to "Next / Skip / Finish".
