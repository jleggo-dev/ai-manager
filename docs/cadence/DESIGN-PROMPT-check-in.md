# Design prompt — the check-in

**Paste-ready for Claude Design.** Self-contained on purpose. Engineering spec:
[`DESIGN-check-in.md`](DESIGN-check-in.md). Brand canon: [`BRAND.md`](BRAND.md).
Owner rulings 2026-08-25.

---

## The prompt

> Design the weekly check-in for **Cadence**, a conversational AI coach app (iOS + web, mobile-first,
> ~390pt wide). Ten surfaces, listed below.
>
> **The product in one line:** a coach you just talk to — it listens, remembers you, and turns what
> you say into a rhythm you can keep. It is a **coach, not a fitness app**; fitness and food are the
> launch focus, not the category. Mental health, spiritual practice and creative habits are equally
> in scope. **Hearth, not scoreboard.**
>
> **The problem we're fixing:** today the plan silently extends itself forever, so nobody reaches the
> end of a week and the coach never gets a natural reason to ask how it went. The check-in that does
> exist is a receipt — some numbers and a warm paragraph, and it cannot change anything. We're giving
> the week a visible edge and making the check-in real: one that ends in a changed plan, the way a
> check-in with a real piano teacher, trainer or manager does.
>
> ### The single most important constraint
>
> **The check-in is not a screen flow. It happens in the conversation.**
>
> There is no wizard, no stepper, no "review screen" you get sent to. The user sends a sentence
> ("I'd like to do my check-in"), and the coach runs it herself — she pulls the week's data and
> **puts a card up in the chat**. Corrections happen on the card. Plan changes are proposed as cards
> and take effect when tapped.
>
> This is an existing rule in the product, not a preference: *"Build is something you do, not
> somewhere you send them. There is no review screen — never tell anyone to head to Review, to
> confirm somewhere, or to go to any screen."*
>
> So most of what you're designing is **cards inside a chat**, plus the two trail surfaces that get
> someone there and one standalone place to look at your own data.

---

## Design system — use exactly these

**Typeface:** Plus Jakarta Sans, everywhere, all weights. One typeface, no carve-outs (holds on
native iOS too). Space Mono is available for small data/utility labels only.

**Palette** (the product's live tokens, not suggestions):

| Token | Hex | Role |
|---|---|---|
| linen | `#fbf9f4` | app ground |
| surface | `#ffffff` | cards |
| line | `#dcd2bc` | rules, borders |
| line-soft | `#eae2d0` | quiet dividers |
| text | `#2c2f33` | primary |
| text-dim | `#5c5f63` | secondary |
| text-mute | `#8b8d91` | tertiary |
| **forest** | `#2c5545` | primary action, structure |
| **sage** | `#8ba88e` | quiet secondary |
| **sun** | `#d85a30` | the one hot accent — **use rarely** |
| **dusk** | `#3e5c76` | depth, the quarterly ritual |
| danger | `#b5453a` | errors only |

**Coach mark:** *Metronome Split* — a geometric C cut on a 45° diagonal, terracotta day over dusk
night.

Design light and dark. Dark goes to a warm, dusk-biased dark — never pure black.

---

## The ten surfaces

### In the plan (the "trail")

**01 · The end of the trail.** The plan is seven days and you can now scroll to the bottom of it.
What's there? Must read as *"your week's done, let's talk"* — never *"you have no plan."* Tapping it
**drops an editable sentence into the coach's composer** ("I'd like to do my check-in") and opens the
conversation. It does not open a check-in screen, because there isn't one.

**02 · The check-in is due.** The lead card at the top of the trail. In your face enough to interrupt
a habit, quiet enough not to nag. Same behaviour as 01 — it hands the user a sentence, already typed,
which they can edit before sending. No badge counts, no red dots, nothing that accrues while ignored.

### In the conversation (the check-in itself)

**03 · The week, as a card she puts up.** The heart of the whole brief. Mid-conversation the coach
says one warm line and emits a card; **the app renders the facts, she never recites them.** Days
kept, sessions done, food logged, weight. Corrections happen right on the card.
- **Editing is opt-in and silence means yes** — a person reads it and moves on in five seconds.
- Anomalies are the exception and want a real answer: a gap in the week, a meal logged but never
  confirmed, a weigh-in that never happened.
- This is a **chat card**, sized and placed for a message thread — not a full screen.

**04 · The conversation around it.** She opens having already pulled the week — like a manager who
read your doc before the 1:1. Not a blank chat box, not a form. Reference points are the owner's real
coaches: a piano teacher who hands you a new piece when you've mastered the last, a trainer who reads
the scale and changes the plan, a boss who asks where you're stuck. Small questions get tappable
options rather than making someone type ("How did the week feel?").

**05 · A change, proposed inline.** She suggests something concrete — swap Thursday's run for a
shorter one, raise the protein target, retire the healed elbow constraint, add a new scale to piano
practice. **Proposed, never applied: the plan changes when the card is tapped, not when she says so.**
Several may come up across one conversation and that's fine — but four accept controls stacked in a
thread is a form wearing a conversation's clothes. That's the problem to solve.

**06 · "Just build it — I trust you."** The opt-out: next week gets built, no conversation. The most
delicate copy here, because the wrong word turns a person *exercising trust* into a person *avoiding
their coach*.
- **Right register:** "Just set my week — I'm good" · "Go ahead and build it"
- **Wrong register:** "Skip" · "Not now" · "Dismiss" · "Maybe later"
- Sits **beside** the invitation on 01/02, never hidden behind it.

### Any time

**07 · Your data, whenever you want it.** A person should be able to look at their own week without
starting a conversation and without being asked to. Same facts as card 03, standalone. Serves the
person who just wants to see it — and the anxious one who wants to look more often than weekly.

**08 · Late, and completely fine.** Someone missed last week's — they were making their kids' lunches
— and they feel bad about it. They come back and say so.
- She just… does it. Calls up last week's window and has the conversation.
- **She never opens with "you missed your check-in."**
- Nothing expired, nothing is overdue, nothing turned red. A check-in is not a thing you can be late
  for — it's a conversation available whenever you want it.
- Design the *absence* of consequence here as carefully as you'd design a feature.

**09 · The quarterly.** Every ~13 weeks, **replacing** that week's check-in: re-measure, show the
distance travelled, reopen the goals themselves. Models are a fitness test with real measurements, a
piano teacher revisiting what you're ultimately working toward, a performance review of wins and
opportunities. The one that should feel *bigger* — the only moment that looks back across months, and
the only one that can change what you're aiming at rather than how you get there. Still level and
unhyped: a milestone, not a celebration screen.

**10 · The week nobody logged.** Someone had a hard week and recorded nothing. There's nothing to
confirm, and *"0 of 7"* is exactly the shame we forbid. What does the coach say to someone who
disappeared for a week and just came back? The app already offers a **detour** for disrupted
stretches — that may be the door. **Genuinely unsolved — please propose the answer.**

---

## Voice rules — a screen that breaks one goes back

| Rule | What it means here |
|---|---|
| **Count what happened** | "You showed up 5 of 7 days." Never "you missed 2." No red marks. Nothing resets to zero |
| **The coach says "I"** | First person on every surface. Never "the coach", never "Cadence thinks" |
| **Confirm before committing** | "Here's what I heard — did I get it right?" is the literal model for card 03 |
| **Their words, not ours** | "Your Tuesday runs", "your pages". Never "your fitness journey", never a category name |
| **Warm, level, unhyped** | A steady friend at 6am. Short sentences. No exclamation marks, no confetti |
| **Plain words for hard things** | "Burnout", "grief" — said simply. No euphemism, no fitness metaphor |
| **Never make them repeat themselves** | The one thing this product promises. It shapes 08 especially |

**Banned outright:** "captured" · "journey" · "unlock" · "empower" · streaks that reset · anything
that would look at home in a habit tracker.

---

## What already exists (extend these, don't reinvent)

- **The trail** — the plan view is already a seven-day scrolling trail. Surfaces 01 and 02 live at
  its bottom and top.
- **Coach cards in chat** — she already emits tappable option blocks and a "build my week" card that
  the app renders. Cards 03, 05 and 06 join that family.
- **Editable pre-filled sentences** — tapping an option already drops the user's own words into the
  composer, where they can edit before sending. That's the entry mechanism for 01 and 02.
- **The proposal card** — an accept/apply pattern for coach-proposed plan changes already ships.
  Card 05 extends it.
- **The week's numbers** — consistency, nutrition averages, weight pace, detours are computed and
  instant. Card 03 and surface 07 need no loading state.
- **Detours** — the existing answer to "life happened". Likely relevant to 08 and 10.
- **Weigh-in** — already folded into the weekly check-in as one moment. Keep it that way.

---

## Four questions we'd like answered in the work

1. **How does the trail show its own edge?** The plan stops at seven days. Does it visibly terminate,
   fade, or arrive at something? The single most important new visual idea in the brief.
2. **How does a facts card live in a chat thread?** Card 03 carries a week of real data but has to
   sit in a message stream without becoming a screen. What's the right density and size?
3. **Can several proposals accumulate without becoming a form?** Low-friction and inline is the goal;
   a stack of Accept buttons is the failure.
4. **What do 08 and 10 say?** The late one and the empty one are the two most likely to land on
   someone having a bad month. We'd rather you proposed the answer than we specified it.
