# Food logging, coach-led — design draft

_Status: DRAFT for owner rulings (2026-10-29). The eval is built and run; nothing in the app is
changed yet._

## The ruling this serves (owner, 2026-10-29)

> "Cadence isn't an App. Cadence is a harness for AI. The AI is in control. She uses tools to do
> analysis for the user and she gives the user UI to interact with her. … For food logging, I
> think she needs to be in charge. Code can't reason — it's guessing at winning matches."

The same principle as TOOL-HARNESS.md (2026-08-23), applied to the place it was never applied: the
food log itself.

## What happens today (traced 2026-10-29)

A described meal (typed, spoken or photographed) runs a pipeline the **code** controls:

1. Code calls the one-shot `parse-meal` job (not the coach). It returns names, stated amounts, and
   its own number guess.
2. Code searches saved foods + the shared database + USDA, and calls FatSecret if those are thin
   (`food-pricing.ts`).
3. **Code picks the winner** (`acceptMatch`: score ≥ 0.7 and clear of the runner-up) and throws the
   rest away. No model ever sees what was found or rejected.
4. Code pins the job's guess as a private food when nothing matched.
5. Code decides whether a background web lookup runs (only when a brand was named).

The coach's own `log_meal` / `preview_meal` tools run the same pipeline, so even in chat she
chooses _when_ to log but never _what_ the numbers are. The tools built for her after 2026-08-23
(`check_food_sources`, `research_food`, `resolve_portion`, `read_label`, `correct_log`) are
reachable in chat but **no logging path is built on them**.

## The split: what stays deterministic, what becomes hers

**Deterministic — no reasoning needed, the user already named the exact thing:**

| Way in                                   | Why it needs no judgement                            |
| ---------------------------------------- | ---------------------------------------------------- |
| Tap a tile (Usual, Leftovers, Cookbook, Planned) | It is a saved food/recipe id                 |
| Find → pick from the list                | The user chose the row                               |
| Barcode scan that hits                   | An exact product key                                 |
| Change an amount on a row                | Arithmetic on a known food (`priceFood`)             |

These log without her knowing at the moment. She reads them the next time you talk
(`get_food_log`), as a coach would.

**Hers — anything that has to be understood before it can be counted:**

- Typed or spoken meals ("eggs on toast and a flat white")
- Photos of a plate
- A barcode that misses → photo of the label (`read_label`)
- Anything a deterministic path could not resolve (a Find search with no good row, if the user
  asks her)

## How a described meal works: software fetches, she decides, once (owner, 2026-10-29)

The owner's second ruling of the day, after the first eval: _"I don't think Cadence should be
going out and making a bunch of separate calls and orchestrating things that are more easily
orchestrated through software. The intent isn't to replace software with AI, it's to allow the AI
to reason through options on the user's behalf."_ The eval agreed: the model's first call in the
rounds shape ("what should I look up?") only restated the food name as a lookup, which is work
software already does. So the shape is **one chained lookup, one adjudicating call**:

1. **You say it.** Type, speak or photograph, from the meal screen, as today.
2. **Software splits and fetches.** The words are split into parts (separators, a peeled-off
   amount); every part goes to every source at once (`fanOutFoodSources`), **FatSecret's top rows
   included**, not the one row a lexical score ranked first. The result is one candidate book:
   every record found, per-100 g numbers, the measures each offers, disagreements named. No model
   yet; about a second; zero tokens.
3. **One call to her.** The words, the slot, and the book. For each part she answers one of three
   ways: a pick (record id + one of its measures + a count), an **assumption** she states ("the
   plain Caffè Latte, since no flavour was named"), or a **question** ("whole or 2%?"). She may
   ask for more lookups **once**, when a part has nothing that fits (the split was wrong, a typo,
   dictated prose with no separators); the second call is her last.
4. **Software prices and writes.** Her picks become grams through the record's own measures, and
   `priceFood` does the arithmetic. She never writes a calorie. An id she was not shown counts
   nothing. **A row with an open question is not counted until it is answered** (the "one cup of
   protein" lesson from run 1).
5. **You confirm.** The card: each part, its amount, its numbers, where the number came from, and
   her assumption in one line where she made one ("I took this as 2% — tap to change"). Her
   question, if any, as chips in her voice.
6. **Logged, and learned.** The chosen record is linked (or pinned as your food) and the phrase is
   remembered, so the same words next time are a deterministic hit and no call at all.

The worked example that started this: "Starbucks venti latte". FatSecret returns six Venti
lattes (Caffè, Chai, Matcha, Lavender, Pistachio…); today's code takes the first row and logs
Matcha. In the single-call shape she sees all six and picks the plain Caffè Latte with the
assumption stated, in 4 seconds and one call (smoke run, 2026-10-29). Code cannot do that step;
nothing else in the flow needed a model.

**Code changes this implies:**

- `log_meal` takes **her adjudicated rows** (food id + grams, or a record she composed) and
  writes them. It stops re-pricing through the waterfall.
- `preview_meal` becomes the card she hands you, built from her rows — not a second parse.
- `acceptMatch`, and the code-decided research trigger, leave the logging path. The waterfall stays
  only as a fallback when she cannot be reached (below), and it says so on the card.
- The one-shot `parse-meal` / `parse-meal-description` jobs stop being the decision-makers. The
  photo's first step (the vision read in prose) can stay a tool she calls.

**What does not change:** allergen flags stay a union (either side may add one, only you clear
one); the arithmetic stays in `priceFood`; everything still runs through AI Admin.

## Making it obvious what's happening (UI)

Today a described meal shows "Looking up the nutrition for that…" and then a card. Nothing says
who did what. Proposal:

- **It reads as her.** The described-meal sheet is a short exchange with the coach (her face, her
  words), not a form with a spinner. Tiles, Find and barcode stay plain and instant — no face — so
  the difference between "I picked this" and "she worked this out" is visible at a glance.
- **Her work is shown as it happens, and it is true.** A short trace under her line, one entry per
  step she actually took: "Checked your foods · Canadian file · USDA — 3 matches, they disagree on
  fat". `check_food_sources` already records `sources_checked` with timings and named skips for
  exactly this; the trace renders from it, never from canned copy.
- **Each row says where its number came from.** "your saved food", "from the label", "USDA",
  "my estimate" — so an estimate never looks like a lookup.
- **One question at a time.** A missing amount is asked as chips (as today), in her voice.
- **She can be reached from the deterministic paths too.** A Find search with nothing good offers
  "ask the coach" rather than "new food".

## Speed and cost — where the tokens go

Three shapes were measured on 2026-10-29. The first is why a full chat turn per log was never on
the table; the other two are the eval's.

| Shape                                             | Calls / meal | Prompt tokens / meal | Of which ours | Of which Devs.ai's fixed preamble |
| ------------------------------------------------- | -----------: | -------------------: | ------------: | --------------------------------: |
| Full coach turn (`ai_log`, 60 days, Sonnet)       |          1–3 |           55k–95k    |      nearly all | ~4,800 per call (~6%)           |
| Food-check, rounds (model asks, then picks; mini) |          2.1 |              ~9,700  |        ~1,500 |             ~5,300 (two calls)    |
| Food-check, single call (software fetched; mini)  |      1 (–2)  |              ~4,800  |        ~1,900 |             ~2,900 (1.1 calls)    |

Reading it: in the rounds shape **78% of the bill was Devs.ai's preamble**, paid twice, and the
model's first call did work the software does for free. In the single-call shape a one-part meal
is about a thousand tokens of ours. Through the Vercel AI Gateway (AI-GATEWAY-EVALUATION.md, its
provider adapter in progress) the preamble column goes to zero, which on these small calls is a
3–4× difference; on a coach turn it is 6%. Latency on the smoke run: 4 s for a one-part meal, 14 s
for a six-part dictated one that needed the second round.

The waiting is shown, not hidden (the owner's 2026-08-21 ruling for photos): her trace fills in
step by step from `sources_checked`, so even 10 s reads as work happening.

The waiting is shown, not hidden (the owner's 2026-08-21 ruling for photos): her trace fills in
step by step, so 10–20 s reads as work happening.

## Who does the deciding: a food-check model, not the full coach (owner, 2026-10-29)

The owner's steer: use a lighter, cheaper model just for reasoning over the food lookups — smart
enough not to make things up — rather than the full coach. "The latest gemini flash/haiku/gpt
minis are pretty decent … and would do better than a deterministic eval."

This keeps the principle intact: **AI decides, code fetches and counts.** What changes is which AI.
The coach stays in charge of the relationship; she sees every log afterwards (`get_food_log`) and
owns corrections (`correct_log`).

**Shape:** a new AI Admin job (`food-check`) on its own small-model profile: **one call** with
the words, the slot and the candidate book the software already fetched (the section above), and a
fixed answer format. Not a chat session, not a tool loop: the fan-out ran before the call, so the
only tool she can ask for is one more round of lookups, and only once. Lean context: no dossier,
no conversation history; recent foods and the dietary profile only if the eval shows they change
answers.

**Guards against made-up answers — built into the shape, not just asked for in the prompt:**

1. **It can only pick what a tool returned.** The final answer names record ids from this turn's
   `check_food_sources` results; code checks each id is real and was returned. A bad id goes back
   to the model as evidence ("that id was not in what you were shown") — a guard reports, it
   does not silently veto.
2. **It never writes a number.** Amounts become grams through `resolve_portion`; calories come from
   `priceFood`. The model chooses records and amounts, never totals.
3. **"My estimate" is a labelled answer, not a disguise.** When nothing fits, it may compose an
   estimate, and the card says so on that row.
4. **Final answer in a strict schema.** Its cost per family is **re-measured by the eval**, not
   assumed: the only number on file (strict json_schema ~free on gpt-4.1-mini, ~2.2× slower on
   gemini-3.5-flash via Devs.ai) is a single bench from 2026-07-04, on a model Devs.ai no longer
   runs.
5. **It hands up when unsure.** Sources disagreeing beyond a set margin, or no usable record, goes
   to the user as one question, or to the coach.

**Model choice — decided by measurement, not by name.** Devs.ai lists models it then refuses to
run (2026-10-27), so every candidate is proved with a live call, and the failover is a different
family from the primary. Candidates: a gpt mini, a Gemini Flash, a Haiku — scored against the
current deterministic matcher (the floor) and the full coach (the ceiling).

**The eval, built from real meals:** the owner's own logs (breakfasts Aug 15 – Sep 9, the free-text
ones included) plus near-miss pairs that a name match gets wrong (skyr vs Greek yogurt, a venti vs
a small latte, homemade vs café). Per model: right record chosen, grams within tolerance, ids it
made up (must be zero), seconds per meal, tokens and cost per meal.

### Eval results — run 1 (2026-10-29)

`apps/cadence-api/scripts/eval-food-check.ts`: 20 meals (10 of the owner's real breakfasts, 10
near-miss pairs), one run per model per meal through Devs.ai, lookups against the owner's real
food ledger. 192 model calls in all.

| Who decides                      | Right (kcal + protein) | Made-up ids | Gave up | Avg time / meal | Avg tokens in / out |
| -------------------------------- | ---------------------: | ----------: | ------: | --------------: | ------------------: |
| Today: `parse-meal` + code match |                  15/20 |           — |       0 |          15.5 s |         4,067 / 1,835 |
| **gpt-5.4-mini**                 |              **19/20** |       **0** |   **0** |       **9.8 s** |       **9,736 / 346** |
| claude-sonnet-5-5 (ceiling)      |                  18/20 |           0 |       2 |           8.4 s |          14,097 / 465 |
| gemini-3.8-flash                 |                  17/20 |           0 |       1 |          63.6 s |        9,884 / 6,912 |
| claude-haiku-5-5                 |                  16/20 |           0 |       2 |          12.0 s |        13,725 / 1,071 |

What the numbers say:

- **Today's code matching is the weakest, and it is not even consistent.** Same words, two runs:
  almonds 160 → **7 kcal**, a small latte 101 → 152, dry rice 187 → 102. It also picked the wrong
  record on powdered peanut butter (100 kcal for ~60) and dry rice (cooked numbers for raw). In
  production the first answer is pinned as the person's food — so a 7 kcal handful of almonds
  would be reused forever.
- **No model invented a record id.** 0 across all four, in every meal.
- **gpt-5.4-mini was right on 19 of 20**, never gave up, and was among the fastest.
- **The bigger models over-research.** Sonnet and Haiku kept asking for lookups on six-part meals
  (the eggs plate, the smoothie bowl) and ran out of turns — a turn budget and a "decide now"
  rule are needed whichever model is chosen.
- **Gemini 3.8 Flash is slow here**: ~6,900 output tokens per meal (thinking), 64 s on average.
- **The one miss every cheap model shares — "one cup of protein".** Read literally as a cup of
  powder (560–850 kcal, ~100 g protein). Haiku asked the right question but still counted it.
  The rule the card needs: **an item with an open question is not counted until it is answered.**

Caveats — read before ruling:

- **n = 1 per model per meal.** A pointer, not a verdict (house rule). Confirm the shortlist with
  repeat runs before a profile change.
- **The expected values are hand-written** (`eval-food-check-cases.ts`, each with its working).
  Two are loose: the Starbucks protein and the baked sweet potato size.
- **Tokens include Devs.ai's fixed overhead** — ~2,640 per GPT call and ~4,820 per Claude call
  (AI-GATEWAY-EVALUATION.md). A gpt-5.4-mini meal (~2 calls) is ~5,300 of its 9,700 tokens in
  overhead; through the gateway it would be ~4,400.
- **Rounds of single calls, not native tool calls** (the deployed HTTP routes carry no app-side
  tools). This measures the judgement over real lookup results, not function-calling reliability.

**Pointer for ruling 1 after run 1:** gpt-5.4-mini primary; failover from another family —
claude-sonnet-5-5. Both proved live in this run. (Confirmed by run 2 below.)

### Eval results — run 2, the single-call shape (2026-10-29)

Same 20 meals, same models, `MODE=single`: software split the words, fanned every part out to the
ledger, USDA **and FatSecret's top 5 rows**, and the model got one call with the whole book (one
more lookup round allowed; the last call offers none). Run twice (2a, then 2b after the decide-now
fix), so n = 2 per meal; 186 model calls in all. Re-scored once offline after a scorer fix (a
model copying the book's "= 118.0 g" after a measure label was being scored as "measure not
offered"), which is why `shown` is saved with every result.

| Model             | Right 2a | Right 2b | Both runs | Made-up ids | Settled in one call | Avg s | Prompt tokens / meal | Of which ours |
| ----------------- | -------: | -------: | --------: | ----------: | ------------------: | ----: | -------------------: | ------------: |
| **gpt-5.4-mini**  |    18/20 |    17/20 | **35/40** |       **0** |               17–18 |   5–6 |      **4,700–4,950** |  **~1,900**   |
| claude-sonnet-5-5 |    19/20 |    17/20 |     36/40 |           0 |               16–17 |   6–8 |          8,000–8,400 |        ~2,500 |
| claude-haiku-5-5  |    16/20 |    18/20 |     34/40 |           0 |               15–17 |  8–10 |          7,900–9,100 |        ~2,700 |
| gemini-3.8-flash  |    15/20 |    16/20 |     31/40 |           0 |               15–17 | 48–56 |          5,000–6,100 |        ~2,800 |

Against the rounds shape (run 1): gpt-5.4-mini went from **9,736 to ~4,800 prompt tokens per
meal** with the same accuracy, and from 9.8 s to ~5.5 s. The saving is the removed first call
and its Devs.ai preamble; "ours" barely moved (~1,500 → ~1,900, because the book is now fetched
for every part up front, FatSecret rows included).

What the misses were, since they decide what the harness needs:

- **The eggs plate (six parts) failed on every model in 2a** — told "this is your last reply"
  while the lookups option was still on the page, all four asked for more lookups anyway. With
  the option removed from the last call (2b) every model answered it right. **The decide-now rule
  has to be in the shape, not the wording.**
- **A measure the record does not offer.** gpt-5.4-mini wrote "1 cup" for a coffee record that
  offers "1 coffee cup (6 fl oz)" and "1 mug (8 fl oz)"; the scorer counts nothing. In the app
  this is the guard case: send the row back once ("that record offers these measures"), as
  TOOL-HARNESS.md says guards report rather than veto.
- **A zero-calorie record in the shared ledger.** "Cafe Latte · 1 drink · 0 kcal" exists and
  gpt-5.4-mini picked it once without reading the number. Two fixes, both software: the book
  should flag a record whose kcal is 0 or missing as `incomplete`, and the ledger row wants
  cleaning. (Sonnet and Haiku skipped it.)
- **Two yardsticks are doubtful, not the models.** Every model picked the same canned coconut
  milk record (142 kcal for ¼ cup against the hand-written 110) and a frozen baked sweet potato
  (130 vs 103). Those expected values want checking before they count against anyone.
- **Prose instead of JSON, twice** (Sonnet once, Gemini once) and **Gemini timeouts** (3 in 2b at
  180 s). A strict output schema, which the gateway enforces and Devs.ai ignores, is the fix for
  the first; the second is Gemini's reasoning length on this prompt.
- **"One cup of protein"**: gpt-5.4-mini read it as powder in 2a (737 kcal) and got it right in
  2b with the assumption stated. Still the case for the rule: a stated assumption is shown on the
  row, a question keeps the row uncounted.

**Ruling 1, confirmed:** gpt-5.4-mini primary, claude-sonnet-5-5 failover. Over 60 scored meals
across both shapes the mini is within one meal of Sonnet at half the tokens; Haiku is close but
dearer; Gemini is too slow here.

**Pointer for the Starbucks case** (`project-cadence-starbucks-latte-mismatch`): with FatSecret's
top rows in the book, every model on every run picked "Caffè Latte (Venti)" over the Matcha the
code logs today, stating the assumption. The code fix that was paused is this design.

## When she can't be reached

The model provider fails sometimes (2026-10-27 outage). A meal must never vanish because a model
did: the words are kept, the meal is saved as **"waiting for the coach"** and counted as an
estimate, and she resolves it on her next turn. The old waterfall can price it meanwhile, labelled
on the card as an automatic estimate, not hers.

## Rulings needed

1. ~~Focused turn or full chat turn~~ — **ruled 2026-10-29: neither; a cheaper food-check model
   decides, chosen by the eval above.** Still open: which model, once measured.
2. **Does the conversation thread show logs she did from the meal screen**, or do they stay in the
   meal screen and she only knows them as facts?
3. **The waterfall's future**: keep as the labelled fallback for outages, or remove entirely?
4. **Her own chat path**: when you tell her about a meal in conversation, does she still log it
   without a card (as today), or always show the card?
5. ~~Budget per log~~ — **settled by the shape (2026-10-29): one call, one optional second round
   of lookups, then she answers with what she has.** Rows with an open question stay uncounted.
6. **FatSecret rows in the book**: the fan-out returns one FatSecret row today (`findFatSecretMatch`,
   `IMPORT_LIMIT 1`). The single-call shape needs the top N (the eval used 5, each a billed
   fetch). Fetch all N up front, or show names first and fetch only her pick?

## Suggested build order

1. ~~The food-check eval~~ — built and run in both shapes (`apps/cadence-api/scripts/eval-food-check*.ts`);
   results above. Owner rules on the model.
2. The `food-check` job + profile (single-call shape), and the candidate book as a service:
   `splitMealParts` + fan-out per part + FatSecret top rows (ruling 6), with the answer-format
   checks from the eval's scorer (`priceItem`: shown ids only, offered measures only).
3. Change `log_meal` / `preview_meal` to take her rows; keep the waterfall behind them only for
   the outage case, labelled.
4. Route the meal screen's Chat / Voice / Photo doors to it; the trace UI, per-row source labels,
   the assumption line, question rows that do not count.
5. Write-back of her verdicts (phrase → food) so repeats get faster.
6. Retire `acceptMatch` and the code-decided research trigger from the logging path.
