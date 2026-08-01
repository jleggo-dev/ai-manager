# Design brief — Mind chromes B & C: the stepped micro-flow and capture

**Goal.** Design the pillar's **two remaining chromes** while chrome A (the calm surface) goes
into code. Chrome A and the now door are settled (the escalation ladder is withdrawn — §1);
this brief covers everything the pillar still can't render.

**Why these two together:** REQ9 §3 frames the pillar as *three chromes, not eleven tools* —
briefing the surface before its payloads is what keeps it coherent. You've delivered **A · the
calm surface**. **B · the stepped micro-flow** (tap-forward cards on a deterministic spine) and
**C · capture** (the existing sheet vocabulary) are both undesigned, and each blocks a different
part of the build. One round, two surfaces, one payload apiece — proving the chrome, not
exhausting it.

## Read these first

- [`../REQ9-mind-tools.md`](../REQ9-mind-tools.md) — §3 the three chromes, §4.3 `grounding`,
  §4.4 `mood_note`, §6 build order. §1 is the register; it hasn't moved.
- Your own `Cadence Mind 1 - Calm Surface + Breath.dc.html` and `Cadence Now Door.dc.html` —
  chrome A and the door as shipped (the ladder in §4g comes out — see §1).
- [`../BRAND.md`](../BRAND.md) — voice.
- Live capture vocabulary to inherit, not reinvent:
  [`CaptureSheet.tsx`](../../../apps/cadence-web/src/features/plan/CaptureSheet.tsx),
  [`MealLogPanel.tsx`](../../../apps/cadence-web/src/features/plan/occurrence/MealLogPanel.tsx),
  and the weigh-in panel — chrome C is *these sheets*, wearing mind content.

## 1. Two corrections to fold in first

**(a) The escalation ladder is withdrawn — please remove it.** Your §4g three-rung sheet and the
emergency-line component should come out of `Cadence Now Door.dc.html`, and the "Something else?"
lines in Mind 1 stay but change meaning. The owner ruled that distress detection and emergency
chrome are **out of scope for a habit coach**, and the repo's own legal drafts agree — Cadence is
*"not medical care… not an emergency service and may not respond in real time."* A standing
emergency affordance makes a promise we can't keep, and phones already dial emergency services.
The coach still responds warmly and defers if someone tells it something serious, but that lives
in conversation, never as a rendered surface. Full reasoning: REQ9 §8.

**What "Something else?" now means:** a practice that isn't landing offers one quiet link into
**the same extras menu the ＋ sheet shows** — a different breathing pattern, a grounding game, a
walk. A tool switch. No rungs, no resources, no safety framing. Talking to the coach needs no
special path; the Coach tab exists.

**(b) The pinned item is too loud.** The labelled pill reads as more important than the day's
actual scheduled activities, and it shouldn't — extras are the *optional* thing, a door you may
not need today. Please restate its visual weight so a pinned extra sits **quieter than a
scheduled item**, and show it in context alongside real trail content so the hierarchy is
checkable rather than asserted.

## 2. What's settled (don't reopen)

- **The register** (REQ9 §1): a practitioner in training; the coach assigns practice; contemplative
  vocabulary, never gym metrics, never clinical language. Your in/out word list stands.
- **The door is one control** — the ＋ FAB with a two-section sheet, "Do something now" above
  "Log something you did." Accepted, and now in REQ9 §3.1.
- **Partial credit is the normal case** — "4 of 10 min · that counts", never a percentage, never
  "incomplete." It generalizes to both chromes here.
- **Tool names changed** (code only, users never see them): `breath`→`breathing`, `sit`→`meditate`,
  `ground`→`grounding`, `listen`→`guided_audio`, and `checkin`→`mood_note` — because **"check-in"
  now means only the coaching conversation** (the weekly one, or the one after an absence). Don't
  let the 20-second mood log and the calibration conversation share a word on any screen.

## 3. Chrome B — the stepped micro-flow, proven with `grounding`

**What it is.** Tap-forward cards on a deterministic spine: a short sequence, one prompt at a
time, no timing pressure, no scoring. It's the surface that later carries chained practices and
the stepped program — so the shape you set here is the one those inherit. **Design it as a
chrome with `grounding` as its first payload, not as a grounding-games screen.**

**The payload — `grounding` (REQ9 §4.3).** Reactive tools for a racing moment. Games:
- `senses` — 5-4-3-2-1 (see 5, hear 4, feel 3, smell 2, taste 1)
- `letters` — A→B→C naming; bank: animals / foods / cities
- `switch` — category switch
- `countback` — count back from 100 by 7s
- `object` — 60 seconds on one object
- `cold` — an instruction card (cool water on the face); no interaction

**The design problem that matters most.** This is used by someone **dysregulated** — the highest
cognitive-load constraint in the pillar. Big targets, minimal chrome, nothing to read, no
decisions. It also has to be **abandonable at any point without failure**: leaving halfway logs
as done, because leaving is often the tool working. Show what a half-finished flow looks like on
the way out.

**Specific asks:**
- The card shell: how a prompt, an input (or no input), and forward motion sit together.
- **Does the person type/tap answers, or just think them and advance?** 5-4-3-2-1 could be five
  taps or five text entries. Recommend — this is the round's biggest fork, and it decides whether
  chrome B is an input surface or a pacing surface.
- The three most different games in place (`senses`, `letters`, `object`) — proving the shell
  flexes without becoming three designs.
- The close: **"did that help?"** (yes / no / skip) → self-report, logged to the arc. It must not
  read as a quiz result.
- **Grounding games are what "Something else?" offers** — show the hand-off: arriving here *from*
  a breathing practice that wasn't landing, and whether "Something else?" is still available once
  you're inside a grounding flow.

## 4. Chrome C — capture, proven with `mood_note`

**What it is.** The existing sheet vocabulary (weigh-in, meal capture), carrying mind content.
Inherit that chrome — this is the one place in the pillar where the answer is "look like what we
already have," and the design job is content and restraint, not invention.

**The payload — `mood_note` (REQ9 §4.4).** The Mind pillar's instrument: the weigh-in of the mind.
Pick the word that fits, an intensity, an optional one-line note. **~20 seconds, every time.** It
feeds baselines and the cross-pillar correlations that are the product's moat, so it has to be
light enough to do daily and specific enough to be worth analysing.

**The open question we want your answer on: the vocabulary.** REQ9 leaves this deliberately
unresolved. We need an emotion word set that is **granular but not clinical** — naming precisely
is itself the practice, but the register bans symptom language. How many words, how surfaced
(a grid? a two-step narrowing? a wheel?), and how someone gets to a word they didn't expect to
need. Propose the actual list.

**Specific asks:**
- The check-in sheet: word → intensity → optional note, and what makes it feel like 20 seconds.
- The vocabulary itself, and its surfacing.
- **Intensity without a clinical scale** — a 1–10 severity slider is exactly the wrong register.
- What the person sees *afterwards*: nothing? a quiet acknowledgment? a pattern once there are
  enough? (Careful — this is where a check-in becomes a mood-tracking dashboard, which is not
  what we're building.)
- How it's entered: a trail node, and from the ＋ sheet's "Do something now" section.

## 5. Small addendum — the `meditate` "came back" tap

`meditate` (REQ9 §4.2) needs **no round of its own** — it's chrome A with bells, and your Mind 1
already shows the chrome carrying it. But you flagged one piece as most likely to be designed
wrong if left late, and you were right: the optional **"came back" tap** — the person taps when
they notice their mind wandered and return. **Noticing the drift *is* the practice; there is
nothing to fail.** Spec just that, inline: what it looks like on the calm surface, what (if
anything) it shows during the sit, and how it reads at the close — a count that never becomes a
score. A few hundred words and one state is plenty.

## 6. Constraints

- **Both chromes must work in all four homes** (REQ9): a trail node · the ＋ sheet's "Do
  something now" · a step inside a session · offered by the coach in chat.
- **Nothing pillar-flavoured in the shell** — the shell law stands; these are payloads.
- **"Something else?" rides chrome B too** — it belongs on a grounding flow, not just on a
  breathing practice.
- Voice per REQ9 §1: the coach speaks as "I", warm, level, no exclamation marks; never names a
  feeling the user hasn't named.
- Everything deterministic — banks, word lists and game rules live in code, generated live by
  nothing. AI personalises *order and framing*, never content.

## 7. Deliverables

390×844 screens with redlines in the handoff's format: the chrome B card shell with `senses`,
`letters` and `object` in place plus the "did that help?" close and the arrive-from-a-stalled-practice
hand-off; the chrome C check-in sheet with your proposed vocabulary and intensity treatment, plus
the after-state; and the `meditate` "came back" addendum. Call the fork on chrome B (input vs pacing)
explicitly, and flag anything you'd want owner-ruled rather than deciding yourself.
