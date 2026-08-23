# Design prompt — seeing what was captured

Hand this to design alongside [`DESIGN-BRIEF-nutrition.md`](DESIGN-BRIEF-nutrition.md) (where the
food surfaces live) and [`DESIGN-PROMPT-food-plan.md`](DESIGN-PROMPT-food-plan.md) (the coaching
loop that runs through them). This one is narrower and more urgent: **you cannot correct what you
cannot see, and as of A23 an uncorrected capture is now permanent.**

---

## The incident, on a real device, 2026-08-22

The owner photographed a pack of dill-pickle-**seasoned peanuts** from a convenience store and
captioned it:

> "These are dill pickles, seasoned peanuts from couchetard or K. I'm going to eat half of the
> pack. The pack is 71 g."

One product. The comma made the parse read two, and it logged **"dill pickles"** alongside
**"seasoned peanuts"**. It logged immediately — that surface has no confirm step — so there was no
moment at which a human could have caught it.

What it got right is as instructive as what it got wrong:

| | |
|---|---|
| Quantity | **35.5 g** — correctly halved the 71 g pack from his words |
| Peanut nutrients | **591 kcal / 50.7 g fat per 100 g** (real peanuts ≈ 567 / 49) — good |
| Vendor | captured, as `brand: "couchetard or K."` |
| The name | **wrong** — one product read as two |
| Day's sodium | **675 mg logged vs ~225 mg real** — the phantom pickle nearly tripled it |

In the owner's words afterwards:

> "It didn't present what I was logging (like in the chat, as it's supposed to) so I didn't have a
> chance to confirm before logging."

> "I genuinely don't know if we captured the food correctly, and I should be able to see which
> foods are contributing to a high fat content for the day."

> "We might not have the right name but we definitely have the right nutrients."

That last line is the whole brief. **The numbers were fine. The label was wrong. Nothing let him
tell the difference, and nothing let him fix the half that was broken.**

## Why this matters more than it used to

Since A23 §1a, a food the app cannot match is **pinned as a permanent private food** so it is only
ever estimated once. That is what makes the same latte cost the same every day — and it also means
a bad capture stops being one bad row and becomes a **durable one that will resolve again**. Both
"Dill Pickles" and "seasoned peanuts (couchetard or K.)" are now in his ledger.

Confirm-first was already the house rule. It is now load-bearing.

## What already exists in code (do not design around its absence)

- **`MealParseCard`** — the confirm-first card for a described meal. Carries the *amounts rule* (an
  amount they said is kept; one they didn't is asked for, as chips) and, new in A23 §1b, a light
  optional "from somewhere?" line for items we could not match.
- **`PhotoReadPanel`** — the Food tab's two-stage photo flow: read the photo into prose, let them
  **edit the prose**, then compute numbers from what they stand behind. This pattern already exists
  and already works.
- **`NutrientsPanel`** — the eight micronutrients as floors and one ceiling, with an honest empty
  state. Already built; already drills off the macro block.
- **`FoodDiary.tsx`** — today's list. Currently shows **kcal only** per item, and kcal + protein per
  slot.
- **The data is already there.** Every pinned food stores name, brand, base unit, full per-100
  nutrients *including all eight micros*, and its serving options. Every logged item carries
  `food_id`, `brand`, and its own full `est`. Nothing below needs new capture — only new display.
- **`correct_log`** exists: a correction re-marks the meal's macros as `source: 'user'`.

## The five things to design

### 1. The capture input is a single line that cannot grow
`MealCapturePhoto.tsx` uses an `<input>`; `LogByChat` and `PhotoReadPanel` use `rows={1}`
textareas. All three are `.mc-cap-in`, 13px, `resize: none`. The owner dictated four sentences into
a one-line box and could not re-read them before sending.

> "This is a tiny little line and it doesn't get bigger as I type, making reviewing what I wrote
> very challenging. It should probably mirror the way chat works in the coach view."

**Design the composer as the coach's chat composer already behaves** — grows with the text, stays
readable, mic in the same place. Voice makes long captions normal, so this is not an edge case.

### 2. One surface logs with no confirm at all
Tapping a meal task in the **plan** logs a photo immediately. The **Food tab** reads, shows, and
waits. Same app, two behaviours, and the one without a brake is the one on the daily path.

Engineering will fix the mechanism (the read-then-confirm pipeline already exists and simply is not
wired here). **Design owns what that confirm shows** — see 3.

### 3. The confirm has to show what was actually captured
Today the card shows names and amounts. The incident needed the *nutrients* visible too: the
numbers were right and the name was wrong, and no arrangement of the current card lets you see
that.

Open questions for design:
- How much nutrition belongs on a confirm card before it stops being confirmable at a glance?
  (Four macros per item? A tap to expand? Micros only on request?)
- **Editing the name while keeping the numbers** — this is the specific move the incident wanted,
  and it is also how our food database gets better: a corrected name on good nutrients is a good
  row. What does that interaction look like without turning a log into a form?
- Merging two items into one ("these are the same thing") — the exact repair this case needed.
- The vendor is captured but never shown. `"couchetard or K."` is a verbatim, slightly messy
  brand. Should a confirm show it, and let it be tidied?

### 4. The day's food list shows only calories
> "When I'm viewing the foods for the day, we should have columns, by food, for all the macros. I
> should be able to see which foods are contributing to a high fat content for the day."

Per-food macros in the day view. The hard part is not the data — it is a four-number row on a phone
that still reads as a list of food rather than a spreadsheet. Note that some items legitimately have
no numbers, and a blank must not read as zero.

### 5. Tapping a food should open its nutrients
The eight micros exist per food and per day and are currently reachable only as a day-level total.
A logged item should open to what it contributed — the natural home for "is this what I actually
ate?".

## Constraints (from BRAND.md, and they are not negotiable)

- **Never judge food.** Count what happened, never what broke. No red, no warnings, no "over".
- **Confirm-first.** Nothing counts until a tap — including a correction.
- **Micro totals are a floor, not a measurement.** They count only food we hold real data for, so
  an honest empty state beats eight bars reading zero. Never imply deficiency.
- **Sodium is the only ceiling.** Floors and ceilings must not look alike; drawing sodium as a goal
  to fill would be actively bad advice.
- **A pinned food is durable.** An unreviewed capture becomes a permanent row, so the confirm is
  the last honest moment. Design it as the moment it now is.
- Warm words in the UI, boring words in the schema (see CLAUDE.md's nomenclature table).

## The one question worth answering first

**Where does correcting an already-logged meal live?**

Everything above improves the moment *before* a log. But the parfait is already saved, the pickle is
already pinned, and the owner's real question was asked afterwards: *did we get this right?* If the
answer is "open the meal, see the numbers, fix the name" then 3, 4 and 5 are one surface rather than
three — and the confirm card is that same surface, shown earlier.

Worth deciding before drawing anything.
