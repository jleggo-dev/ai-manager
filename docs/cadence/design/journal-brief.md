# Design brief — the Journal: the pillar's first module

**Goal.** Design the journal — writing and speaking a short entry, the prompt chips that make a
blank page approachable, the **store** where entries live and can be reread, the per-entry
privacy lock, and the share-out moment for a gratitude note. This is the Mind pillar's first
**module-class** piece: the writing box is small, and *the store is the product* — a journal you
can't reread isn't a journal, it's a form.

Three later builds inherit what you set here: voice capture, the gratitude share-out, and the
chained practices (evening review, thought-reframe) that write their steps *into* this store.

## Read these first

- [`../REQ9-mind-tools.md`](../REQ9-mind-tools.md) — §4.5 the journal (modes, banks, store,
  privacy), §4.6 gratitude's three tiers, **§8 the scope ruling** (it decides this module's
  hardest questions — see "Two rules" below).
- Your own `Cadence Mind 2 - Stepped Flow + Capture.dc.html` — chrome C is the capture
  vocabulary this inherits, and `feeling_log`'s "no surface" rule is the one this module must
  NOT inherit (the distinction is the heart of the brief).
- Your own `Cadence Food Module.dc.html` + the live
  [`features/food/`](../../../apps/cadence-web/src/features/food/) — the module-depth precedent,
  including how Food ended up living WITHOUT a tab (a strip + a Today section).
- The crude thing this replaces:
  [`SimpleTools.tsx`](../../../apps/cadence-web/src/features/walkthrough/tools/SimpleTools.tsx)
  `StepJournal` — a bare textarea with a `MicButton`. The mic is already in the sheet vocabulary.
- [`../BRAND.md`](../BRAND.md) — note especially: **"captured" is banned in user copy.** An app
  that says "entry captured" over someone's private thoughts has told them exactly how it thinks
  of them. "Saved," "kept," or nothing.

## Two rules that decide everything here

**1 · The journal shows your words back; it never shows analysis of them.** The store is
reverse-chron rereading — your own sentences, as you wrote them. No sentiment colours, no theme
clusters, no charts, no writing streak inside the module. (Gratitude consistency surfaces in the
*recap*, in the coach's voice — never as a scoreboard here.) The Scribe does extract themes to
case notes behind the scenes (`parse_mind_log`), but that is coaching context, invisible in this
UI. `feeling_log` earned "nowhere to look at your feelings"; the journal earns the opposite —
**somewhere to reread your words** — and the line between the two is *words in, words back;
never words in, judgments back.*

**2 · Private means private — entirely.** The coach reads entries by default, and says so
plainly once, at first use: *"I keep your notes so I can know you better — mark anything private
and I won't use it."* The per-entry lock excludes an entry from context packs **and from Scribe
parsing entirely** (REQ9 §8 resolved this: no safety-scan, no aggregate signal, nothing). The
toggle works retroactively — locking an entry later removes it from future packs. Design the
lock so it feels like closing a drawer, not like flagging a risk.

## What to design

**1 · The entry surface — typed.** An entry is two-minutes-shaped, not twenty-seconds-shaped,
so decide (and recommend): does writing get chrome C's tall sheet, or a full screen like the
walkthrough? States: empty-with-chips → writing → saved. The save confirmation is one quiet
line; the coach's voice, no celebration. When an entry began from a prompt chip, the prompt is
kept with the entry (the question is half the meaning when rereading).

**2 · The prompt chips.** Deterministic banks (below), coach-ordered by relevance, **blank page
always allowed** — chips seed, never trap: tapping one starts the entry with the question
standing above the writing space, dismissible back to blank. Pressure-test the open state:
chips-first or blank-first, which reduces drop-off? Recommend with reasoning.

**3 · The v1 bank copy — yours to write.** Like the feeling vocabulary, the banks are
deterministic, live in `@cadence/shared`, and the coach may reorder but never edit. Propose the
actual wording for: **gratitude** (three good things), **savor** (photo + a line), **a win**,
**smallest next thing**, **what's actually true**, **worry-park** (write it down to put it
down). Each bank: the chip label + the prompt line that stands above the entry. Register per
REQ9 §1 — and remember these are questions a coach asks, not worksheet headings.

**4 · Voice.** Record → transcript appears → **edit** → save. The audio itself is discarded
after transcription in v1 — say so honestly and warmly in the UI (*"I keep the words, not the
recording"*), because for a journal that's a privacy feature, not a limitation. Design: the mic
states (idle / recording / transcribing), the edit-the-transcript moment, transcription failure
(offer retry or type — never lose what they said without saying so), and the first-time mic
permission ask in the coach's voice.

**5 · The store.** Reverse-chron list of entries: date, the prompt it grew from (if any), the
first line or two, the privacy state. Tap to read full. Rule 1 applies with full force — this
screen is a bookshelf, not a dashboard. Design a locked entry's appearance in the list (visible
that it exists, styled as yours-only), and the read view of a single entry.

**6 · Placement — recommend.** Where does the journal live? Follow the Food precedent (module
depth without necessarily a tab): candidates are a Today-adjacent section, a row under Progress,
or its own space reached from the mind practices themselves. Entries also *arrive* from three
directions — a journal step inside a session, the ＋ sheet's "Do something now," and the module
itself — so the module is the home, not the only door.

**7 · The gratitude share-out** (REQ9 §4.6 tier 2 — the deferral-dissolver). A gratitude entry
addressed to a real person gets one affordance: share it **via the OS share sheet** — *they*
send it from their own iMessage/WhatsApp/email; we never send anything. The close is the
practice's own framing: *"send it, read it to them, or keep it"* — writing it already did most
of the work, so sharing is genuinely optional and the UI must not nag. Design the affordance on
the entry and the moment around the share sheet.

**8 · One small recap moment.** Entries resurface only in the coach's voice — the weekly recap
or chat ("three weeks ago you wrote…"), never as an automated widget. Show how a quoted entry
looks inside the existing recap surface: the user's words visibly *quoted*, distinct from the
coach's own voice, private entries never quoted at all.

## Constraints / don't break

- **"Captured" never appears.** Nor "logged," ideally, for journal entries — this is the one
  surface where the warm word and the honest word are the same: "kept," "saved."
- **No analysis anywhere in the module** (rule 1). No streaks, no counts, no "you've written 12
  entries this month."
- **Chained practices write here.** An evening-review step's answers become entries in this
  store — the walkthrough is one of the doors. Nothing about an entry reveals which door it
  came through except the kept prompt.
- The first-use privacy disclosure uses the owner-approved line verbatim (rule 2).
- Save must feel instant and certain — a journal that might lose words is dead on arrival.
- Voice stays optional furniture; typing is never more than one tap away from a mic state.
- Stay in the system: chrome C's sheet vocabulary, oklch tokens, Fraunces/Nunito, the tone ramp.

## Deliverables

390×844 screens with redlines in the handoff's format: the entry surface (empty-with-chips →
writing → saved), the six bank chips with your proposed copy, the voice flow (idle → recording →
transcript-edit → save, + the failure state), the store list (including a locked entry) and the
single-entry read view, the first-use privacy disclosure moment, the per-entry lock interaction,
the gratitude share-out affordance + share moment, the quoted-entry treatment in recap, and your
placement recommendation. Call the fork on sheet-vs-full-screen and chips-vs-blank explicitly.
