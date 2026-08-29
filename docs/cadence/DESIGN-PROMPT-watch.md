# Design prompt — Cadence on the wrist (watch app v1.5)

**Paste-ready for Claude Design.** Self-contained on purpose. Engineering record:
`PLAN.md` §"A13 revisited" (owner rulings 2026-08-29). Brand canon: [`BRAND.md`](BRAND.md).

---

## The prompt

> Design the Apple Watch app for **Cadence**, a conversational AI coach. This is the product's
> first native watch surface, and it is deliberately small: **five faces**, listed below.
>
> **The product in one line:** a coach you just talk to — it listens, remembers you, and turns
> what you say into a rhythm you can keep. A **coach, not a fitness app**; fitness is the launch
> focus, not the category. **Hearth, not scoreboard** — and a wrist is where scoreboards live,
> which makes this the hardest brand test the product has faced.
>
> **What the watch app is:** the coach's plan, runnable from the wrist. The user's phone already
> holds this week's sessions; the watch shows today's, and runs the ones a wrist is good at —
> intervals, strength timers, a meditation sit — with live heart rate, our chimes, and our
> colours. Apple's workout engine runs underneath (sensors, calories, the save to Health); our
> app is the face on it.
>
> **What the watch app is NOT:** it does not track runs. An outdoor run in the list hands off,
> in one tap, to Apple's own Workout app — GPS is theirs on purpose. There is no mid-run
> coaching (that's v2), no complication, no Smart Stack card, no custom notification layout yet.
> Do not design those.
>
> ### The single most important constraint
>
> **The wrist is glanced at, not read.** The phone's interval player already has the right
> contract, in its own shipped copy: *"the screen turns amber when it is time to push and green
> when it is time to breathe, and a chime marks every handover — so you can put the phone on the
> floor and work from the colour and the sound."* The watch inherits that contract and adds the
> haptic. Every face should survive: sweaty hands, three seconds of attention, mid-plank.

---

## Design system — use exactly these

**Typeface:** Plus Jakarta Sans, everywhere (it holds on native iOS; watchOS embeds custom fonts
in SwiftUI). Space Mono for small data/utility labels only — a heart-rate number qualifies.

**Palette** (the product's live tokens):

| Token | Hex | Role |
|---|---|---|
| linen | `#fbf9f4` | app ground (phone) — see question 1 |
| surface | `#ffffff` | cards |
| line | `#dcd2bc` | rules, borders |
| text | `#2c2f33` | primary |
| text-dim | `#5c5f63` | secondary |
| **forest** | `#2c5545` | primary action, structure |
| **sage** | `#8ba88e` | quiet secondary |
| **sun** | `#d85a30` | the one hot accent — **use rarely** |
| **dusk** | `#3e5c76` | depth |
| danger | `#b5453a` | errors only |

The interval player's phase colours are already product law: **amber = push, green = breathe,
grey = neither.** Keep the meanings; tune the values for OLED if needed.

**Coach mark:** *Metronome Split* — a geometric C cut on a 45° diagonal, terracotta day over
dusk night.

**Canvas:** design at 45mm (396×484pt); verify at 41mm (352×430pt). Ultra (410×502pt) gets more
room, never different behaviour.

---

## The five faces

**01 · Today.** The sessions the coach set for today — usually one, sometimes two or three, often
none. Each row: what it is, roughly how long, and one tap to start. A **run** row is visually the
same family but its tap opens Apple's Workout app pre-loaded — design the row so that hand-off
reads as *the coach handing you to the right tool*, never as being kicked out of Cadence (see
question 3). A rest day is quiet and warm — never an empty state, never "no workouts scheduled."

**02 · The interval face.** The hero. Work/recover rounds with the amber/green/grey contract,
a chime and a haptic at every handover, round count as "Round 3 of 6", and **live heart rate as
information** — a number that is present the way a clock is present, not a gauge begging to be
raised (see question 2). Tap to pause. Stopping early **keeps the rounds you actually did** — the
end of a stopped session must feel like a receipt, not a penalty. Design the Always-On dimmed
state: colour must still carry the phase when the wrist drops.

**03 · The timer face.** The plain cousin of 02, for strength blocks and timed holds: the item's
name ("Goblet squats · 3×8"), elapsed or remaining, live HR, done. Same silhouette as 02 so the
two read as one tool wearing two moods.

**04 · The sit.** Meditation on the wrist: start, bells as haptic + soft chime (start/end, or
interval bells), and the **"came back" tap** — the phone tool's rule holds verbatim: it never
shows a running total. **No heart rate on this face, ever.** HR during a sit is a calm signal
for the coach's later reading, never a live number — a pulse on screen during meditation is a
scoreboard on the one face that must not have one. Breathing is **not** in scope unless design
finds a shape that is not Apple's Mindfulness app wearing our colours — if it doesn't earn its
place, leave it on the phone.

**05 · Done.** The workout saved itself to Apple Health (rings close; that's Apple's moment, let
them have it). Ours is one warm line and the facts: what happened — rounds, minutes, average
heart rate — in the register of *count what happened*. "5 rounds, 14 minutes" — never "1 round
short." One tap back to Today. If the user stopped early, this face is where that must feel
completely fine.

---

## Voice rules — a face that breaks one goes back

| Rule | On the wrist |
|---|---|
| **Count what happened** | Rounds done, minutes moved. Never what was left. Nothing resets |
| **The coach says "I"** | Sparingly here — the wrist is mostly the tool, not the voice. Where words appear, they're hers |
| **Warm, level, unhyped** | No confetti, no fireworks, no "crushed it". A steady nod |
| **Hearth, not scoreboard** | HR is information. No zones drawn as targets, no colour-coded judgment on a number |
| **Their words** | The session's own name from the plan ("Tuesday intervals"), never a category label |

**Banned outright:** "captured" · "journey" · "unlock" · "empower" · streak anything · any face
that could be mistaken for a leaderboard.

---

## What already exists (extend, don't reinvent)

- **The phone interval player** — amber/green phases, chimes, "Round 3 of 6", pause on tap,
  stopping early keeps the rounds. The watch faces 02/03 are its wrist-sized siblings, not a new
  design language.
- **The meditate tool** — bells (none / start+end / interval) and the "came back" tap, rules
  already ruled. Face 04 ports it.
- **The session shapes** — every runnable item arrives structured (work/recover/rounds,
  durations, names) from the same composer the phone uses. No face needs a loading state for
  its own content.
- **The hand-off** — the phone already schedules runs into Apple's Workout app ("On your watch
  for Thursday"); face 01's run row is the wrist-side door to the same thing.
- **Notifications already reach the watch** (iPhone mirroring), with the coach's portrait via
  communication notifications. Nothing to design there yet.

---

## Four questions we'd like answered in the work

1. **Does the hearth survive OLED?** The platform idiom is pure black ground (bezel disappears,
   battery loves it); the brand's dark is "warm, dusk-biased — never pure black." Which wins on
   a watch, and what does linen-warmth even mean at 45mm? This is the brief's deepest brand
   question — we'd rather you answer it than we guess.
2. **What does heart rate look like as information, not judgment?** A number with no target
   drawn around it, present but not performing. If it quietly changes size/prominence by
   context (working vs resting face), show us.
3. **The hand-off moment.** Tapping a run opens Apple's Workout app. What half-second of framing
   makes that feel like the coach handing you to the right tool — and what does the user see
   from us when they're done and back?
4. **How quiet can Done be?** The temptation is a summary screen; the brand wants a nod. Where
   is the line between a receipt and a report card?
