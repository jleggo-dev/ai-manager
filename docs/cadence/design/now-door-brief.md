# Design brief — the "right now" door + the escalation ladder (corrections to Mind 1)

> **⚠️ PARTIALLY SUPERSEDED (2026-08-01) — read this first.**
>
> **The door shipped. The escalation ladder did not.** A later owner ruling
> ([REQ9 §8](../REQ9-mind-tools.md)) withdrew the ladder's rung 3 and the whole safety apparatus
> around it: **no emergency chrome, no crisis card component, no resource section in any menu, and
> no chat-side distress detection** — the repo's own legal drafts disclaim being "an emergency
> service", and detection that exists but misses is a worse posture than an honest scope. The line
> that replaced it: *reason about what people DO; never scan what they SAY for pathology.*
>
> **Still live in this brief:** §1–§4 (the neutral door, the two-tense sheet, the express lane,
> the persona test set) and rungs 1–2 of §5 ("Something else?" as a tool switch → alternates →
> chat). Those built and shipped.
>
> **Dead on arrival:** rung 3, the reusable emergency-line component, and the region-aware
> resource deck. Sections below are struck through where they'd otherwise read as instructions.
> Kept rather than deleted because the reasoning in §1 about *why* the rail was wrong is what
> produced the ruling — but do not build from the struck parts.

**Goal.** Two coupled corrections to `Cadence Mind 1 - Calm Surface + Breath.dc.html`, one design
round: **(1)** generalize §3B's now door — it was a pillar-specific control promoted to global
chrome; **(2)** replace §3E's crisis rail with an **escalation ladder** — the rail conflated two
things that must never share a control ("name animals starting with A" and "dial 911").
Everything else in Mind 1 stands: register, calm surface, pacer, partial credit.

Both corrections are the same law applied at different altitudes — your own principle, "the
scenario lives in the coach's sentence, never baked into the tool," extended to chrome and to
safety furniture: **the shell offers neutral doors; the coach decides what's behind them; and
"crisis" is reserved for actual crises.**

## 1. What was wrong

**The door.** A persistent mindset-dawn breath disc in every user's shell assumes every user's
"right now" is *calm*. Three real users break it: someone here for **nutrition + fitness** ("why
am I being presented with a chill-out button?"); someone building a **dental-hygiene routine**;
a sixteen-year-old reading Thomas Merton building a **spiritual practice**. A pillar was
colonizing the shell.

**The rail.** One line of furniture on every mind surface routing to deferral copy + resources
mixes the everyday and the emergency. Someone spiraling who taps it needs *a different
technique* — distraction, grounding, exactly the coachable moment this product exists for — and
instead gets "reach a professional," which abandons them and pathologizes ordinary anxiety (the
clinical pole, back through the furniture). Meanwhile a true emergency deserves an unmistakable,
separate line that never becomes an everyday relief valve.

## 2. What survives from Mind 1

- The **tense analysis** — ＋ is past ("log something you did"), the door is present ("I have
  something right now"). It's the organizing idea of the fix.
- The **placement work** — bottom-right stack above the ＋, thumb-reachable, header rejected.
- The **one-tap argument** — someone mid-spiral shouldn't face a menu. Survives as a *per-user
  coach decision* (§4), not a shell default.
- The **phase-1 timing insight** — in-the-moment help must exist from the first calm tool. It
  was right about *when*; the ladder (§5) fixes *what*.
- The disc craft itself (48×44 pressable sibling of the ＋).

## 3. The generalized door

**"I have something right now"** is universal; its *content* is personal and plan-relative. The
door opens a short sheet — **"Do something now"** — listing 3–5 items the coach composed for
*this person*, each recognizable as theirs:

- The calm-program user: *3 long exhales · 5-4-3-2-1 · a short sit* — their coach's recommended
  settle-downs.
- The athlete whose workout felt light: *15-min stretch · an extra 20 pushups · a 10-min walk*.
- The practice user: *10 Hail Marys · an evening examen* — their tradition, their words; the
  coach supplies rhythm, never doctrine.
- Always appended: a free line — *"something else — tell me"* → coach chat.

Items bind to tools/activities that exist (the catalog law) and log through the normal rails —
extra work credits progression and the day footer ("also today: 6 breaths"). The menu is
**composed ahead of time and cached** (REQ10 §6); the tap never waits on a model.

**Why this dissolves the legibility problem** (the owner's earlier question — "do I know why this
button is there?"): the sun-disc needed explaining because it wasn't *yours*. A menu of your own
named practices needs no label — its contents are the label.

## 4. The express lane — coach-prescribed, per person

For a user whose coach knows a spiral shouldn't sit behind a menu, the coach **pins one item**:
it renders as the sheet's dominant first action — or, when the coach judges it warranted, as a
dedicated one-tap disc above the door (your original drawing, returned as a *prescription* for
one person rather than a default for everyone). The pinned item is in the coach's voice ("Three
long exhales — I'll count").

## 5. The escalation ladder — replaces the rail

Every **in-practice surface** (the calm surface while breathing, a grounding game, later the
guided sit) carries one quiet, ever-present affordance: **"Something else?"** It is a **tool
switch, never an exit** — tapping it opens a small sheet:

- **Rung 1 — the alternates.** The coach's *other* in-the-moment tools for this person: the
  distraction family (A→B→C animals, 5-4-3-2-1, category switch), a different breath, a short
  walk. This is the `right_now` subset of the same composed menu that fills the door (REQ10
  §6) — one composer, two tenses: "do something now" (the door) / "this isn't landing" (the
  ladder). Breathing was never the only tool; mid-breath, this hands you the rest.
- **Rung 2 — the coach.** "Talk to me" → chat.
- ~~**Rung 3 — the emergency line.**~~ **WITHDRAWN (REQ9 §8).** No emergency line, no region-aware
  resource deck, no vetted deferral component. Phones already dial emergency services; a standing
  emergency affordance inside a habit app makes a promise ("we are watching") that we cannot keep.
  What remains is coach behavior in conversation, living entirely in the system prompt: if someone
  says something serious, acknowledge it plainly, say it's beyond what a coach should carry, and
  encourage a professional. One warm response in context — never a product surface.

**Rules:** nothing labeled or flavored "crisis" appears on a practice surface — and after §8,
nowhere else either. Everyday rough moments are coaching, not crises. Switching tools mid-practice
keeps partial credit for the abandoned practice (abandoning is information, not failure).
~~The chat-side distress detection and fixed vetted response are unchanged~~ — **there is no
distress detection.** It was withdrawn wholesale; nothing scans messages or journal entries.

This dissolves the "absent while breathing" ruling (what's present while breathing is "Something
else?" — an offer, not an alarm). ~~and shrinks the copy deck to rung 3~~ — with rung 3 gone, the
copy deck is gone with it.

## 6. What to design

- **The door at rest** — a neutral, non-pillar affordance: glyph, resting label (if any), and how
  it sits with the ＋ (two controls? one control, two-section sheet? — **recommend**, revisiting
  your stack now that the door is neutral).
- **The "Do something now" sheet** — the three persona fills above as the test set: same chrome,
  three different lives. Include the free-text line.
- **The express lane** — the pinned-item sheet variant and the promoted-disc variant.
- **The ladder** — "Something else?" in place on the breathing screen (running state) and the
  sheet with its ~~three~~ **two** rungs (alternates, then chat).
  ~~the emergency line's treatment at rest … design it as a reusable component … a fixed crisis
  card in the conversation~~ — **all withdrawn (REQ9 §8).** Design no emergency line and no crisis
  card; there is no detection to trigger one.
- **First encounter** — how the door introduces itself once, in the coach's voice (one line in
  the day-recap bubble, e.g. "that little door is always there — for when you've got a few
  minutes or need one"), then never explains again.
- **The empty state** — a brand-new user with no committed plan: recommend (leaning: no door
  until a plan exists).

## 7. Constraints

- **No pillar color, glyph, or copy in the shell.** The door is the app's, not Mind's. Mindset
  dawn appears only on items that *are* mind items, inside the sheet.
- Menu content is coach-composed and cached; **zero model calls at tap time**. The emergency
  line is app-fixed copy, never composed.
- The breath surface, register, and calm chrome from Mind 1 are unchanged — breath becomes a
  *payload* reachable through the door for users whose coach put it there; its §3E close loses
  the rail and gains "Something else?".
- Voice per REQ9 §1 / BRAND: the coach speaks as "I"; warm, level, no exclamation marks; the
  door never names a feeling the user hasn't named ("a minute is available here," never "you
  seem stressed").

## 8. Deliverables

390×844 screens with redlines in the handoff's format: the door at rest (+ its relationship to
＋), the "Do something now" sheet in all three persona fills, the express-lane + promoted-disc
variants, the breathing screen carrying "Something else?", the ladder sheet with the emergency
line, the first-encounter line in situ, and the empty state. Note any copy you'd change, and
your recommendation on one-control-vs-two.
