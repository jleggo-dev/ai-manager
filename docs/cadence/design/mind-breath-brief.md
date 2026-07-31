# Design brief — Mind 1: the calm surface, proven with the breath practice

**Goal.** Design **archetype A — the calm surface** (the full-screen, low-light, one-moving-thing
chrome that will carry breath, the silent timer, guided sits and sleep wind-down), proven with its
first payload: a **breath practice**. Plus the pillar **spine** every later mind surface inherits —
the three entry doors, the close, and the crisis rail.

This merges what your assessment called briefs 0 and 1. The spine decisions here are **pillar-wide,
not breath-specific**; everything after inherits them.

## Read these first

- **The frame + the tool plan:** [`../REQ9-mind-tools.md`](../REQ9-mind-tools.md) — §1 is the
  register (**read first**), §3 the complexity taxonomy, §4.1 the full `breath` model and preset
  bank, §6 the build order.
  *(REQ6/REQ7 are cited there but are **not on `main`** — don't go looking. REQ9 is self-contained
  and supersedes them for build purposes. This answers the "send REQ6 before design" ask in your
  assessment.)*
- **Voice + nomenclature, canonical:** [`../BRAND.md`](../BRAND.md).
- **The tool rail:** [`../REQ8-task-walkthrough-and-tools.md`](../REQ8-task-walkthrough-and-tools.md)
  + [`tool-catalog.ts`](../../../packages/cadence-shared/src/tool-catalog.ts) — the coach composes
  only from catalog tools; `breath` becomes a new entry.
- **Live source:** [`StepTimer.tsx`](../../../apps/cadence-web/src/features/walkthrough/tools/StepTimer.tsx),
  [`useStepTimer.ts`](../../../apps/cadence-web/src/features/walkthrough/tools/useStepTimer.ts),
  [`chime.ts`](../../../apps/cadence-web/src/features/walkthrough/tools/chime.ts),
  [`tone.ts`](../../../apps/cadence-web/src/features/walkthrough/tools/tone.ts),
  [`taskShape.ts`](../../../apps/cadence-web/src/features/plan/taskShape.ts),
  [`category.ts`](../../../apps/cadence-web/src/features/today/category.ts).
- **In this project:** `design_handoff_cadence_today/README.md` (visual language),
  `Cadence Mind Pillar - Assessment.dc.html` (yours — §3 below says what we took),
  `Cadence Mind Toolkit.dc.html` (the pass §1 corrects).

## 1. The frame — read REQ9 §1, then this

**The user is a practitioner in training.** Same coaching *structure* as the body side — the coach
assigns practice, sessions have shape, repetition compounds — with vocabulary borrowed from the
contemplative tradition rather than the gym. "A guru or bodhisattva in training, without the
religious context." Sit, settle, notice, return, attention. **Not** reps, load, progression,
performance, "mental fitness." **Not** symptoms, treatment, therapy, "mental health."

**What went wrong last pass.** `Cadence Mind Toolkit.dc.html` reframed the pillar as *"mental
fitness — a gym for attention,"* deliberately borrowed the body's words (a rep = "a return," load
= "minutes"), and concluded *"stress, focus and calm become performance topics."* Gratitude became
a parameter and self-worth vanished — a gym has nowhere to put it.

**The trap in the other direction — don't take it.** The tempting over-correction is pure soft
invitation with no coach: no structure, no assignment, only gentle offers. Equally wrong. The
coach is warm **and** it programs your practice.

## 2. Settled — carry forward, don't re-open

- **No new pillar hue.** Mind already owns mindset `oklch(76% 0.15 55)` and reflection
  `oklch(57% 0.15 266)`. Your later withdrawal of the violet proposal was right — and the reason
  you gave is the one that matters: a cool violet would make the calm tools read medical. Two
  glyphs (rayed sun / moon), existing hues, disc colour still from time of day.
- **Partial credit** — "4 of 10 min · that counts." Never a percentage, never "incomplete."
- **The scenario lives in the coach's sentence, never baked into the tool.**
- The **pacer craft** in the Toolkit's §2e (270px ring with real margins, the setup screen, "Find
  my rhythm — tap four turns") is good work. §1 replaces the framing around it, not the craft.

## 3. Adopted from your assessment

Your structural read was right and we're building on it. Adopted:

- **The three archetypes** — this brief is archetype A, briefed as a chrome with payloads, so the
  silent timer / guided sit / wind-down inherit consistency instead of negotiating for it.
- **The crisis rail is shell-level, not phase-3-level.** You were right and an earlier draft of
  this brief was wrong to defer it. People reach a breath pacer *while dysregulated*, in phase 1.
  The rail ships with the first calm surface. It's in §4 below.
- **Don't reuse StepTimer's ring.** "A ring reads as time remaining, and breath is a phase loop,
  not a countdown; a filling ring during a 4-count exhale fights the instruction." Correct. Share
  the chrome (card, pre-roll, chime, log-on-complete); replace the ring.
- **"Did it help?" resolved once**, pillar-wide — §4.
- **Screen-off is the design target, not a variant.**
- **Standalone-first**, with the walkthrough embedding the same surface as a step — never a second
  implementation.
- **Two dials is one too many.** Default to last-used; put pattern and length behind one line.
- **Wind-down early** — accepted as a design constraint here (the surface must accept a fade
  without redesign), though we still build it after breath and sit.

Not adopted: the `oklch(52% 0.07 268)` hue (superseded by your own withdrawal — see §2).

## 4. The spine — specify once, here; everything inherits it

> **⚠️ Superseded in part (2026-07-31):** the now-door portion of this section was generalized
> after Mind 1 shipped — the door is now a **neutral shell affordance with a coach-composed,
> plan-relative menu**, not a Mind-owned breath disc. See
> [`now-door-brief.md`](now-door-brief.md) and REQ10 §6. Everything else in this brief stands.

**Three entry doors.** A scheduled trail node · an **unscheduled "now" door** reachable from
anywhere without a task existing first · a coach-offered door mid-chat. You flagged the
unscheduled door as under-specified and the one an anxious person actually needs — agreed, and
it's a first-class deliverable here:

- **Where does it live?** Today, the ＋ FAB, or both — **recommend**, don't just pick.
- **Zero to breathing in one tap** — no setup screen from the now door; land in the breathing
  state on last-used settings. The setup screen still exists for deliberate use; show both paths.
- **Unscheduled use draws no trail node.** It logs to the day and shows quietly ("also today: 6
  breaths"); the trail stays a picture of what was planned.
- One-handed, late at night, low brightness, by someone not in a patient mood.

**One close.** It happened → logged; then *optionally* "did that help?" as a single three-way tap,
dismissible by leaving. One design, one copy line, one log shape, **asked at most once a day
across all mind surfaces** — your call, taken. Include the partial state.

**The rail, same place always.** One line of furniture, identical position and copy on every mind
surface from phase 1. Routes to deferral copy + resources. Never colour-coded as an alarm, never a
modal, never absent — reads as an exit, not a warning. *Design the placement and treatment; the
shipping copy deck is owner-supplied and lands before build.*

## 5. The payload: `breath`

Model, nine presets and safety caps are in **REQ9 §4.1** — read there rather than have it
restated. A pattern is ordered phases `[{label, seconds, cue}] × cycles`; one player animates any
pattern; the coach picks pattern + cycles and writes the framing line; the person can override.

**Two presets stress the animation model — solve them explicitly:**
- **Physiological sigh** — two inhales inside one cycle (full breath, short top-up, long release).
- **Alternate nostril** — a per-phase instruction telling the hand what to do.

Both must read clearly without turning a calming screen into something you have to study.

## 6. What to design, in order

**6a. Register check — first, before any screens.** Roughly six coach lines inviting the *same*
breath practice in six moments: a scheduled morning practice · wired at 11pm · mid-spiral via the
now door · before something hard · after a hard day · the first time ever, explaining what this is
for. Six sentences. If the register is off we both see it here and neither of us spends a round on
pixels.

**6b. The spine** — the now door in place, the one-tap path, the close, the rail's placement.

**6c. The calm surface + breath** — setup and running states; show what the surface looks like as
a chrome that will also carry a silent timer, a guided sit and a wind-down fade.

**6d. The close in situ** — partial credit and the optional "did that help?".

## 7. Constraints / don't break

- **The workout scaffolding must be invisible.** Same engine as the exercise walkthrough, but no
  "Step 1 of 5," no sets/reps/load language, no framing that makes a practice an accessory to a
  workout. Design as if the fitness system didn't exist; we wire it silently.
- **One surface, four homes, unchanged:** now door · trail node · a step inside a session ·
  offered in chat.
- **Voice:** the coach speaks as "I". Warm, level, unhurried, no exclamation marks. Missed and
  partial are neutral, never red. Abandoning is information, not failure.
- Stay in the system: oklch tokens, Fraunces/Nunito, pressable discs, bottom-anchored sheets, the
  time-of-day tone ramp.

## 8. Deliverables

Screens at 390×844 with redlines in the handoff's format (oklch, sizes, spacing, radii, shadows):
the register check (text), the now door in place, the one-tap entry, the calm surface with the
pacer at setup and running (including how you solved the double-inhale and the hand cue), the rail
in position, and the close + partial-credit state. Name the file something that isn't "Toolkit."

## 9. Open forks — propose, don't resolve

Owner calls. Your assessment raised the last two; both are noted in REQ9 §7:
- One `mind` area vs sub-areas (design input welcome; the schema already separates `mind` from
  `practice`).
- Whether the coach agentically offers a tool mid-chat — design the offered-entry *surface* either
  way; the trigger is out of scope.
- Where "did it help?" lands in the data model, and whether recap consumes mind self-reports the
  way it consumes body counts.
- Whether the content library is its own tab, lives under Mind, or is a shared surface.
