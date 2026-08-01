# Design brief — Mind chromes B & C: the stepped micro-flow and capture

**Goal.** Design the pillar's **two remaining chromes** while chrome A (the calm surface) goes
into code. Chrome A, the now door and the escalation ladder are settled — this brief covers
everything the pillar still can't render.

**Why these two together:** REQ9 §3 frames the pillar as *three chromes, not eleven tools* —
briefing the surface before its payloads is what keeps it coherent. You've delivered **A · the
calm surface**. **B · the stepped micro-flow** (tap-forward cards on a deterministic spine) and
**C · capture** (the existing sheet vocabulary) are both undesigned, and each blocks a different
part of the build. One round, two surfaces, one payload apiece — proving the chrome, not
exhausting it.

## Read these first

- [`../REQ9-mind-tools.md`](../REQ9-mind-tools.md) — §3 the three chromes, §4.3 `ground`,
  §4.4 `checkin`, §6 build order. §1 is the register; it hasn't moved.
- Your own `Cadence Mind 1 - Calm Surface + Breath.dc.html` and `Cadence Now Door.dc.html` —
  chrome A and the door/ladder as shipped.
- [`../BRAND.md`](../BRAND.md) — voice.
- Live capture vocabulary to inherit, not reinvent:
  [`CaptureSheet.tsx`](../../../apps/cadence-web/src/features/plan/CaptureSheet.tsx),
  [`MealLogPanel.tsx`](../../../apps/cadence-web/src/features/plan/occurrence/MealLogPanel.tsx),
  and the weigh-in panel — chrome C is *these sheets*, wearing mind content.

## 1. What's settled (don't reopen)

- **The register** (REQ9 §1): a practitioner in training; the coach assigns practice; contemplative
  vocabulary, never gym metrics, never clinical language. Your in/out word list stands.
- **The door is one control** — the ＋ FAB with a two-section sheet, "Do something now" above
  "Log something you did." Accepted, and now in REQ9 §3.1.
- **The ladder** — "Something else?" on practice surfaces, three rungs, emergency line last and
  reusable. Accepted. Copy is final except the emergency line itself.
- **Partial credit is the normal case** — "4 of 10 min · that counts", never a percentage, never
  "incomplete." It generalizes to both chromes here.

## 2. Chrome B — the stepped micro-flow, proven with `ground`

**What it is.** Tap-forward cards on a deterministic spine: a short sequence, one prompt at a
time, no timing pressure, no scoring. It's the surface that later carries chained practices and
the stepped program — so the shape you set here is the one those inherit. **Design it as a
chrome with `ground` as its first payload, not as a grounding-games screen.**

**The payload — `ground` (REQ9 §4.3).** Reactive tools for a racing moment. Games:
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
- **`ground` is rung 1 of the ladder** — these are exactly what "Something else?" offers. Show
  the hand-off: arriving here *from* a breath practice that wasn't landing, and whether the
  ladder is still reachable once you're inside a grounding flow.

## 3. Chrome C — capture, proven with `checkin`

**What it is.** The existing sheet vocabulary (weigh-in, meal capture), carrying mind content.
Inherit that chrome — this is the one place in the pillar where the answer is "look like what we
already have," and the design job is content and restraint, not invention.

**The payload — `checkin` (REQ9 §4.4).** The Mind pillar's instrument: the weigh-in of the mind.
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

## 4. Small addendum — the `sit` "came back" tap

`sit` (REQ9 §4.2) needs **no round of its own** — it's chrome A with bells, and your Mind 1
already shows the chrome carrying it. But you flagged one piece as most likely to be designed
wrong if left late, and you were right: the optional **"came back" tap** — the person taps when
they notice their mind wandered and return. **Noticing the drift *is* the practice; there is
nothing to fail.** Spec just that, inline: what it looks like on the calm surface, what (if
anything) it shows during the sit, and how it reads at the close — a count that never becomes a
score. A few hundred words and one state is plenty.

## 5. Constraints

- **Both chromes must work in all four homes** (REQ9): a trail node · the ＋ sheet's "Do
  something now" · a step inside a session · offered by the coach in chat.
- **Nothing pillar-flavoured in the shell** — the shell law stands; these are payloads.
- **The ladder rides chrome B surfaces too** — "Something else?" belongs on a grounding flow, not
  just on breath.
- Voice per REQ9 §1: the coach speaks as "I", warm, level, no exclamation marks; never names a
  feeling the user hasn't named.
- Everything deterministic — banks, word lists and game rules live in code, generated live by
  nothing. AI personalises *order and framing*, never content.

## 6. Deliverables

390×844 screens with redlines in the handoff's format: the chrome B card shell with `senses`,
`letters` and `object` in place plus the "did that help?" close and the arrive-from-the-ladder
hand-off; the chrome C check-in sheet with your proposed vocabulary and intensity treatment, plus
the after-state; and the `sit` "came back" addendum. Call the fork on chrome B (input vs pacing)
explicitly, and flag anything you'd want owner-ruled rather than deciding yourself.
