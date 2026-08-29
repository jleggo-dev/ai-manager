# Design prompt — Cadence on the wrist (watch app v1.5)

**Run through a design round 2026-08-29** — canvas: *Cadence on the Wrist*
(claude.ai/code/artifact/54b03895-811b-48c8-95a8-a0174441e090, thirteen boards). The four
questions below are now **answered** (owner-ruled where marked), the face set grew from five to
thirteen, and the honesty contract got its own section. This file is the settled spec the build
works from; the canvas is the picture of it. Engineering record: `PLAN.md` §"A13 revisited".
Brand canon: [`BRAND.md`](BRAND.md).

---

## The prompt (as settled)

> Design the Apple Watch app for **Cadence**, a conversational AI coach. This is the product's
> first native watch surface.
>
> **The product in one line:** a coach you just talk to — it listens, remembers you, and turns
> what you say into a rhythm you can keep. A **coach, not a fitness app**. **Hearth, not
> scoreboard** — and a wrist is where scoreboards live, which makes this the hardest brand test
> the product has faced.
>
> **What the watch app is:** the coach's plan, runnable from the wrist — today's sessions and the
> week, the ones a wrist is good at run in our frame (intervals, strength timers, a sit) with
> live heart rate, our chimes, our colours. Apple's workout engine runs underneath (sensors,
> calories, the save to Health); our app is the face on it.
>
> **What the watch app is NOT:** it does not track runs — a run row hands off, in one tap, to
> Apple's own Workout app; GPS is theirs on purpose. No mid-run coaching (v2), no complication,
> no Smart Stack card, no custom notification layout yet.
>
> ### The single most important constraint
>
> **The wrist is glanced at, not read.** The phone's interval player owns the contract: *"the
> screen turns amber when it is time to push and green when it is time to breathe, and a chime
> marks every handover."* The watch inherits it and adds the haptic. Every face must survive:
> sweaty hands, three seconds of attention, mid-plank.

---

## Design system — settled values, use exactly these

**Typeface:** Plus Jakarta Sans everywhere; Space Mono for data values only (a heart-rate number,
a `3 × 8 · 24 kg` spec, a countdown label like `0:45 hold`).

**Ground (Q1, owner-ruled):** **true black, everywhere.** The bezel disappears and Always-On
stays honest; the hearth lives **in the light** — linen white and the brand greys, never browned
tints. A warm-dark `#1b1815` alternate was drawn and rejected: it read brown, and the screen edge
showed as a grey rectangle on the wrist. (Related same-day ruling: no browned ambers anywhere —
darkening amber to make a ground turns it to ochre; the phase colours stay at full brightness on
black instead.)

**Palette — every value is a token, a `tone.ts` stop, or a token at alpha:**

| Use | Value | Source |
|---|---|---|
| Primary text | `#fbf9f4` | linen |
| Secondary text | `#8b8d91` · whispers `#5c5f63` | text-mute / text-dim |
| Card fill | `rgba(251,249,244,0.07)` | linen at alpha |
| Hairlines, ghost borders | `rgba(220,210,188,0.16–0.28)` | line at alpha |
| Primary button | bg `#8ba88e`, text `#2c5545` | sage on forest — the brand pair |
| The one hot accent | `#d85a30` (hand-off arrow, End) | sun — use rarely |
| The sit's family | `#3e5c76` at alpha; glyphs are dusk lifted for black | dusk |
| Work phase | fill `oklch(79% 0.16 70)` · done `oklch(63% 0.15 68)` | tone.ts, verbatim |
| Recover phase | fill `oklch(66% 0.11 152)` · done `oklch(52% 0.09 152)` | tone.ts, verbatim |
| Phase track (ahead) | the fill stop at `/ 0.22` | tone.ts pattern |

**The signature is the ring-as-session** (`intervalRing.ts`): one wedge per phase, sized by its
seconds — the ring's shape IS the session's shape, so a Tabata looks nothing like a HIIT before
you press anything. Past wedges wear the *done* stop, the current one fills in the *fill* stop,
the shape ahead sits in track tint — which is why "what's left" never needs a caption. The ring
appears live (around the countdown), finished (on Done), dimmed (Always-On), and segmented per
day on the week view, exactly as the phone's trail does.

**The coach's face:** the user's chosen portrait — a picture, never a personality — anchors the
Today and rest-day headers and speaks on the hand-off face ("I've set up your run…"). The
Metronome Split mark stays the app icon; on the faces themselves, her portrait is the presence.

**Canvas:** 45mm (396×484pt) primary; verify 41mm (352×430); Ultra gets more room, never
different behaviour. Top-right stays clear for the system clock — never paint a fake one.

---

## The faces (thirteen boards on the canvas)

**Core five:**
- **01 · Today** — portrait + weekday, then today's sessions as cards; a run row's tap opens
  Apple's Workout app (framed as the coach handing you to the right tool). Rest day is its own
  quiet board — never an empty state.
- **02 · Intervals, live** — the hero: wedge ring around the countdown, phase word and numerals
  in the phase colour, "Round 3 of 6", HR small in a corner, tap to pause. The ring replaced the
  "then 20s to breathe" caption — the shape ahead is that information.
- **03 · Timer, mid-set** — name + spec (`3 × 8 · 24 kg` in mono), set dots (done sets filled
  sage), big elapsed, HR, "up next — Split squats", **Set done**.
- **04 · The sit** — bells as haptic + chime, quiet remaining time, the "came back" tap (never a
  running total). **No heart rate on this face, ever.** Breathing stays off the wrist unless a
  shape exists that is not Apple's Mindfulness app in our colours.
- **05 · Done (Q4, answered)** — the finished ring, one warm line ("That's done."), three facts,
  the felt question (Easy / Right / Hard — it feeds next week's plan), the mic row, "Saved to
  Health" as a whisper, one exit. No score, no comparison; the rings closing are Apple's moment.

**The honesty surfaces (added by the round — see "The contract"):**
- **06 · Controls** — one swipe away: Pause · Skip phase · Next exercise · End (End in sun).
  Captioned with the player's own promise: stopping early keeps the rounds you did; a skipped
  push never counts as done.
- **07 · Your week** — the whole plan: seven day rows with trail-style segmented rings (done in
  sage, today carded, rest quiet), footer counting what happened ("showed up 2 of 2 so far").
- **08 · Session detail** — the prescription before starting: blocks, every item with sets ×
  reps @ load in mono, **Start** beside **Less time** (the phone's condense).
- **09 · Set-log** — "I did 5, not 6": the crown turns the number, "planned 8" stays as a
  whisper, the button logs reality (**Log 5**).
- **10 · Hands full** — a timed hold (dead hang): "Get set" pre-roll, starts on the chime, ends
  itself, double-tap skips. Nothing needs a touch.

**States and moments:** **11 · Always-On** (dim ring + numeral in the done stop, no HR) ·
**12 · Rest day** (portrait header, crescent, "Today's clear. Rest is part of the rhythm.", one
line about tomorrow) · **13 · Hand-off (Q3, answered)** — her portrait, one line ("I've set up
your run — Workout takes it from here"), the run card, "opens automatically"; the return needs no
design — the finished run comes back through the read-back as an ordinary Done.

---

## The contract on the wrist (owner, 2026-08-29 — "those functions somehow")

The phone's honesty affordances all exist here, each in its watch-native form:

| The phone's promise | On the wrist |
|---|---|
| Tap pauses; what you said stays | Tap pauses (02) |
| Skip phase / skip exercise | Controls page, one swipe (06) |
| Stopping early keeps the rounds you did | Written on the controls page; Done shows what happened |
| A skipped push never counts as done | Same rule, same wording |
| "I did 5, not 6" | The crown amends at set-log (09) |
| "I did more/less/different" | The mic on Done — dictation into the same words-to-log path the phone uses (05) |
| "I don't have time for all of it" | Less time beside Start (08) |
| Hands are occupied | Pre-roll + chime; holds run themselves; double-tap skips (10) |

Buildability, stated honestly: crown input, dictation, chimes/haptics and pre-rolls are plain
watchOS APIs — nothing above is speculative. The one conditional is **double-tap** (Series 9 /
Ultra 2 hardware; degrades to a tap elsewhere — copy must not promise it universally).

---

## Voice rules — a face that breaks one goes back

| Rule | On the wrist |
|---|---|
| **Count what happened** | Rounds done, minutes moved, "Log 5". Never what was left. Nothing resets |
| **The coach says "I"** | Sparingly — the wrist is mostly the tool. Where words appear (hand-off), they're hers, under her face |
| **Warm, level, unhyped** | No confetti, no "crushed it". A steady nod |
| **Hearth, not scoreboard** | HR is information (Q2, answered): Space Mono, small, corner, no zone bar, no colour on the number; absent on the sit |
| **Their words** | The session's own name from the plan, never a category label |

**Banned outright:** "captured" · "journey" · "unlock" · "empower" · streak anything · any face
that could be mistaken for a leaderboard.

---

## Still open (small, deliberate)

- The numeral-vs-ring size trade on the live face (76px inside the ring vs 118px bare) shipped
  ring-first; revisit only if the device round says glanceability lost.
- Whether Week (07) and Session detail (08) land in the v1.5 build or fast-follow — a build-scope
  call, not a design one.
- Double-tap copy on hardware that lacks it.
- Breathing on the wrist: out until it earns its place.
