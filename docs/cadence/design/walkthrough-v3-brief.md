# Design brief: walkthrough v3 (swap a move, timed sets, rearrange the session)

**For:** Claude Design. **Build plan:** [`../WALKTHROUGH-V3-PLAN.md`](../WALKTHROUGH-V3-PLAN.md). **Owner request:** 2026-11-02, written from four screenshots of a real gym
session ("Obstacle strength: pull, carry…", 18 steps).

**Goal.** In the middle of a session, the person can change the session to match the day and the
way they actually train. That means swapping a move, adding weight, rearranging the order, and
seeing a real timer wherever a move is timed. The coach then learns from what they changed.
Everything has to be **fast**: it is used between sets, on a phone, sometimes holding a kettlebell.

The walkthrough is not only for workouts. It also plays breathing, meditation, journaling and
instrument practice. The patterns below are drawn for strength and cardio, but name the general
version of each ("swap this step", "rearrange the steps") so it can carry over to other areas.

## Read these first

- [`walkthrough-redesign-brief.md`](walkthrough-redesign-brief.md): v2 (browse / do / commit, the
  ring as sets, the ring as rounds, the Recap). **v3 builds on it and does not replace it.**
- [`redesign-today-trail/README.md`](redesign-today-trail/README.md): tokens, discs, rings, the tone
  ramp, pressable bottom edges, Fraunces/Nunito.
- [`../BRAND.md`](../BRAND.md): a coach, never a fitness app. Warm, level, unhyped. The coach speaks as
  "I". Confirm before committing ("here's what I heard — did I get it right?"). No streak-shame.
  Spell out units (never "5P 7C").
- The code today, all under `apps/cadence-web/src/features/walkthrough/`:
  - `Walkthrough.tsx`: the shell.
  - `wt-parts.tsx` `StepHeader`: title, target chip, Form link, and the cue text.
  - `tools/StepReps.tsx`: a ring of sets and a dial.
  - `tools/StepCircuit.tsx`: a rounds ring, the current move, and the rotation list.
  - `tools/StepTimer.tsx`: a hold or effort timer, with a chime and switch-sides.
  - `tools/StepInterval.tsx`: work/recover phases, where the frame colour is the signal.

## What went wrong in the session (the screenshots)

1. **Glute bridge, "12 × bodyweight · 2 sets".** The person wanted to add weight, and had no way
   to do it. They logged reps against a load they did not lift.
2. **Dumbbell row.** The cue text stops mid-sentence: "…If the 40 lb feels easy for". (Engineering
   is fixing the server cut. Design still needs a home for long cues.)
3. **Farmer carries, "1 × 2 x 40 lb kettlebells · 4 sets".** A carry is timed (40–45 s), but it
   played as a reps dial counting "1 rep".
4. **Abs circuit.** The moves are tagged TIMER (30 s), but the card says "30s hold — self-timed" and
   shows no clock.
5. **Structure.** The coach wrote "3 sets of presses, then 3 sets of rows". The person trains
   differently: 1 set of presses, then 1 set of rows, alternating. That is a circuit they build
   themselves. They also can't do 3 × 45 s dead hangs back to back, or straight after pull-ups, but
   they can when the hangs are spread through the session.

## What to design

### A. Swap a move, or adjust it (fast)

Each strength or cardio step gets one affordance that opens a sheet. The sheet has three parts:

- **Adjust this move.** Change the load ("+5 lb", "add a 20 lb plate", "bodyweight → 15 lb
  dumbbell"), change the reps or time, or make the move easier or harder. The change applies to
  the rest of this step, and the log records what was actually lifted. The load becomes editable
  per set: a set can be 12 × 15 lb even when the target said bodyweight.
- **Swap for…** shows 2–3 alternatives that are **already in hand when the session opens**: the
  coach wrote them with the session, so there is no wait. Each row shows the name and target, a
  short reason ("same muscles, no bench"), and the equipment it uses. Rows marked "you've done this"
  show the last time: "Last: 3 × 10 · 25 lb · Oct 28". Running → bike → skipping rope is the cardio
  version of the same list.
- **Ask the coach for something else.** This is the slow path. Show honestly that it takes a
  moment. It must never block the fast rows above it.

Show what a swapped step looks like afterwards (in the step header, the All-steps sheet and the
Recap), so it reads as "you swapped X for Y", not as if X was skipped.

### B. Timed sets: one pattern for carries, hangs and planks × 3

Today there are two ways to show a set: a reps dial or a single timer. Design a third way, **sets of
a timed effort**. The ring still shows the sets, but each set runs a countdown (40 s), with an
optional rest between sets, then "Log set 2 · 40 s". This must cover:

- a carry (one load, a time or distance target, "about 40 m or 40–45 s");
- a hold done one side then the other (the switch-sides chime already exists);
- a timed move **inside a circuit**. The same small timer replaces the "self-timed" line in the
  circuit card's middle band, and when it finishes it moves on to the next move.
  The person must be able to log less time than the target honestly ("32 s of 45"), just as reps can
  be under target today.

### C. Rearrange the session myself, then tell the coach

This **reverses a v2 constraint**, which said straight vs circuit is the coach's choice and not a
user toggle. The owner is now asking for the person to control it. Design:

- **Alternate these.** Select 2–3 straight steps (bench press, rows) and turn them into "1 set of
  each, then go round", which is a circuit built from existing steps. Also offer the reverse: split a
  circuit back into straight sets.
- **Spread these out.** Take a hard move (3 × 45 s dead hang) and place its sets between other steps,
  so set 1 comes after the warm-up, set 2 after rows, and so on.
- **Reorder** steps, and **move one set** of a step somewhere else.
- **It's quick to undo.** Rearranging logs nothing, which matches the "Back and Next only move you"
  promise.
- **Telling the coach.** At Finish, or in the Recap, the coach says what she noticed and asks before
  she keeps it, in her own voice. For example: _"You alternated presses and rows, and spread the
  hangs out. Want me to plan it that way next time?"_ with **Yes, every time** / **Just today**.
  Nothing should be learned silently.
- Where the rearranging lives: the All-steps sheet? An edit mode? Long-press? Your call. It must
  work one-handed, between sets.

### D. Long cue text

The cue under the title can be 2–4 sentences (form, a substitution, "tell me if…"). Design a clamp
plus "more", or a better home for the text, that doesn't push the tool below the fold on a 375 × 812
phone. Apply the same treatment to circuit moves, which today don't show their cue at all.

## Constraints / don't break

- v2's grammar stays: browse / do / commit, the ring as sets, the ring as rounds, nothing commits
  until Finish, and the Recap.
- Every captured thing must reduce to a short log line, such as `3×12 @ 15 lb (swapped from glute
bridge)`, `4×40 s`, or `circuit 3 rounds`. That line is the coach's signal.
- Thumb reach and big targets. The person is mid-workout, sweaty, and often has the phone on a bench.
- No streaks, no "unlock", no "journey". Use plain words for units: "40 seconds", "15 lb".

## Deliverables

Screens and states, with redlines in the handoff's format (oklch, sizes, spacing, radii, shadows):

1. A reps step with the swap/adjust sheet open, with history rows, and the "ask the coach" row in its
   waiting state.
2. A reps step after adding weight: per-set loads in the set chips.
3. A timed-sets step (a farmer carry) at rest between sets and mid-set, plus logging under target.
4. A circuit with a timed move running.
5. The rearrange flow: alternate two steps, spread a move's sets, and the result in All steps.
6. The Recap / Finish moment where the coach asks to keep the new structure.
7. A long cue, collapsed and expanded.

Note any naming changes you'd make (Swap / Adjust / Rearrange / Alternate / Spread out) against
BRAND.md.
