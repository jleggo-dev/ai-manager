# Food logging, coach-led — design draft

_Status: build steps 2, 3 and 4 SHIPPED 2026-11-01 (step 2: the `food-check` job on its own
profile, the candidate book as a service, the described-meal doors wired through it; step 3: the
coach's `log_meal` runs the same read and logs through the card's confirm path; step 4: the photo
door's confirmed reading goes through the same read, onto the same card — see "Suggested build
order" and the three "What was built" sections at the end). Rulings 2, 3, 4 and 6 are still the
owner's._

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

| Way in                                           | Why it needs no judgement                |
| ------------------------------------------------ | ---------------------------------------- |
| Tap a tile (Usual, Leftovers, Cookbook, Planned) | It is a saved food/recipe id             |
| Find → pick from the list                        | The user chose the row                   |
| Barcode scan that hits                           | An exact product key                     |
| Change an amount on a row                        | Arithmetic on a known food (`priceFood`) |

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
| Full coach turn (`ai_log`, 60 days, Sonnet)       |          1–3 |              55k–95k |    nearly all |             ~4,800 per call (~6%) |
| Food-check, rounds (model asks, then picks; mini) |          2.1 |               ~9,700 |        ~1,500 |                ~5,300 (two calls) |
| Food-check, single call (software fetched; mini)  |       1 (–2) |               ~4,800 |        ~1,900 |                ~2,900 (1.1 calls) |

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
| Today: `parse-meal` + code match |                  15/20 |           — |       0 |          15.5 s |       4,067 / 1,835 |
| **gpt-5.4-mini**                 |              **19/20** |       **0** |   **0** |       **9.8 s** |     **9,736 / 346** |
| claude-sonnet-5-5 (ceiling)      |                  18/20 |           0 |       2 |           8.4 s |        14,097 / 465 |
| gemini-3.8-flash                 |                  17/20 |           0 |       1 |          63.6 s |       9,884 / 6,912 |
| claude-haiku-5-5                 |                  16/20 |           0 |       2 |          12.0 s |      13,725 / 1,071 |

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
| **gpt-5.4-mini**  |    18/20 |    17/20 | **35/40** |       **0** |               17–18 |   5–6 |      **4,700–4,950** |    **~1,900** |
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

### Eval results — run 3, the shipped job (2026-11-01)

`npm run eval:food-check -- --prompt-from-config`: the `food-check` job's own prompt and strict
schema as the config ships them, through the service's split, book and round loop
(`food-candidate-book.ts`, `food-candidate-sources.ts`, `food-check.ts`) — the eval of what
production runs, not of a prompt kept beside it. Same 20 meals, lookups against the owner's real
ledger, USDA and FatSecret's top 5 rows. gpt-5.4-mini run twice (3a, 3b), claude-sonnet-5-5 once;
71 model calls in all. The bar was run 2: 35/40 at about 4,800 prompt tokens a call.

| Model             | Right 3a | Right 3b | Both runs | Made-up ids | Settled in one call | Avg s | Prompt tokens / call (avg · median) |
| ----------------- | -------: | -------: | --------: | ----------: | ------------------: | ----: | ----------------------------------: |
| **gpt-5.4-mini**  |    18/20 |    18/20 | **36/40** |       **0** |               16–17 |   5–6 |                5,300–5,700 · ~4,600 |
| claude-sonnet-5-5 |    19/20 |        — |     19/20 |           0 |                  17 |   8.0 |                      8,200 · ~7,400 |

Reading it:

- **The bar holds: 36/40 against 35/40**, with no made-up id in 71 calls and no failed meal. Both
  pointers of ruling 1 answered live on 2026-11-01, so both are proved callable today.
- **The Starbucks Venti latte (#426) lands.** Every run on both models picked "Caffè Latte
  (Venti)" at 250 kcal / 16 g protein — the case that started this.
- **Tokens: the median call is at the bar, the average above it.** ~4,600 median against ~4,800;
  the average (5,300–5,700) is pulled up by the two six-part meals (the eggs plate's second call
  carried an 11k-token book). Two things grew the book on purpose: eight records shown per lookup
  (was six) and the plain-name/brand rules for estimates. Through the gateway the Devs.ai preamble
  (~2,600 of each call) goes to zero.
- **The two misses are the same two every time, and neither is new.** (1) `pair-coconut-canned`:
  every model on every run picks the same canned coconut milk record (142 kcal for ¼ cup against
  the hand-written 110) — run 2 already called that yardstick doubtful; it wants checking before
  it counts against anyone. (2) `pair-latte-small`: gpt-5.4-mini twice picked a record with no
  small size — once "1 serving" at 60 kcal, once the shared ledger's **"Cafe Latte · 1 drink · 0
  kcal"** even though the book marked it `incomplete: no usable calories`. Sonnet picked a sized
  latte at 150. The marker is in the book and in the prompt; the model read past it once. The
  software fix the run-2 notes asked for still stands: that ledger row wants cleaning (an
  `incomplete` record is still a record she can pick, by design — a guard reports, it does not
  veto).
- **The guard round fired zero times** across 71 calls: no pick outside the book, no measure a
  record did not offer. The one-extra-lookups round fired on 3–4 meals per run, always the
  dictated or six-part ones.
- **Caveats, as before:** n = 2 for the mini and 1 for Sonnet (a pointer, not a verdict); two
  Sonnet calls came back with no usage figures and count as 0 in its average; USDA answered 400
  on a few lookups during the run and the trace recorded it as "USDA failed" (the fan-out moved
  on, as designed).

### Eval results — run 4, after review (2026-11-01, later the same day)

The PR review of step 2 found that run 3 had not run the production prompt shape: the eval posted
the whole filled prompt as one `{{prompt}}` variable, so the engine's `<user_input>` wrapper
never went round `round_rule` and `guard_notes`, and the engine's 10,000-character cut on any
variable fell on the whole prompt (tail first — `</book>` and the last parts' records) without
anyone seeing it. Run 4 fixes both and measures the fixed job: the e2e job carries the shipped
`promptTemplate` and `variables`, each call sends only the five variables, the engine fills them
as it does live; the book fits itself to a budget (round-robin by part, the cut announced in the
part's head — see "What was built", 3; for this run the budget was 9,900 characters, the engine's
cap less a margin — it was then set to its own 12,000 once #454 raised the cap, see run 5); the
three pick steers are out of the prompt and `estimate.kcal` / `protein_g` are nullable.
gpt-5.4-mini once over the 20 meals, 21 calls; then the one new miss re-run twice.

| Model            | Right | kcal ok | Made-up ids | Settled in one call | Avg s | Prompt tokens / call (avg · median) |
| ---------------- | ----: | ------: | ----------: | ------------------: | ----: | ----------------------------------: |
| **gpt-5.4-mini** | 17/20 |   18/20 |       **0** |                  19 |   5.2 |                       4,908 · 4,642 |

Reading it:

- **17/20 against the bar's 35/40 (17.5 a run)**: within one meal of the bar at n = 1, not above
  it. Tokens are at the bar (median 4,642 against ~4,800) now that the book fits itself; the
  average fell from 5,300–5,700 to 4,908 because no call carries an 11k-token book any more.
- **The same two misses as every run**, unchanged: `pair-coconut-canned` (the doubtful 110-kcal
  yardstick) and `pair-latte-small` (the shared ledger's zero-kcal "Cafe Latte · 1 drink" row,
  picked again with the `incomplete` marker beside it — the row wants cleaning; in production
  that reply also carried a question, and a question row now counts nothing, so the card would
  show an open row rather than 0 kcal).
- **The one new miss is variance, not the budget.** `real-smoothie-protein`: the model estimated
  the skyr at 60 kcal / 7.5 g protein instead of picking (protein total off). The book for that
  meal was rebuilt locally: it renders at 9,685 characters with 13 of 40 rows held back; the
  owner's own "Organic Skyr Yogurt" row was shown first, and the two rows held back from that
  part were "Frozen Yogurt" and "Yogurt Chips". Re-run twice, the meal was right both times
  (once by estimating the skyr at 100 / 15, once by picking a record). Seen in the rebuild and
  worth its own fix: the split leaves "2/3 a cup skyr yoghurt" as the lookup "a cup skyr
  yoghurt" — a fraction followed by "a cup" is not peeled — which is why that part's records were
  mostly noise (a peanut-butter cup, a dessert topping).
- **The guard round fired zero times** again; the extra-lookups round fired once over the 20.

### Eval results — run 5, the book's own budget under the raised cap (2026-11-01)

Same job and eval as run 4, after #454 (the engine's variable cap 40,000, a cut logged) was
merged into the branch and `BOOK_BUDGET_CHARS` became the book's own 12,000 characters (sized
from the token bar; the arithmetic is on the constant). gpt-5.4-mini once over the 20 meals,
23 calls.

| Model            | Right | kcal ok | Made-up ids | Settled in one call | Avg s | Prompt tokens / call (avg · median) | Largest call |
| ---------------- | ----: | ------: | ----------: | ------------------: | ----: | ----------------------------------: | -----------: |
| **gpt-5.4-mini** | 17/20 |   17/20 |       **0** |                  17 |   5.9 |                       5,072 · 4,630 |        7,629 |

Reading it:

- **The median call did not move** (4,630 against run 4's 4,642): a meal of one to three parts
  never fills either budget. The average rose from 4,908 to 5,072 and the largest call from
  ~6,400 to 7,629 — the long meals keep more rows a part now, and pay for them. Both are what the
  constant's arithmetic said they would be.
- **17/20 again**, the two fixed misses unchanged. The third is new in kind, not in cause:
  `pair-almonds` ("a handful of almonds") picked the "1 almond" record and asked "About how many
  almonds is a handful?" — a question row. In the app that row carries no number until the
  amount is answered (review item 3); the eval's scorer still prices the pick at count 1 and
  calls it 7 kcal, which is the scorer's shape, not the app's. The scorer could skip question
  rows to match production; left as it is so runs stay comparable. The smoothie that missed in
  run 4 was right.
- **Three meals took the extra-lookups round** (one in run 4); the guard round fired zero times.

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
2. ~~The `food-check` job + profile (single-call shape), and the candidate book as a service~~ —
   **built 2026-11-01**, see "What was built" below. The split, the fan-out per part with
   FatSecret's top rows, the book, the one-call-plus-one shape, the answer-format checks, the
   pricing through `priceFood`, the phrase memory, the labelled fallback, and the typed/spoken
   doors on it. Ruling 6 is built as the eval ran it (top 5 rows fetched in full) and stays open.
3. ~~Change `log_meal` / `preview_meal` to take her rows; keep the waterfall behind them only for
   the outage case, labelled.~~ — **built 2026-11-01**, see "What was built (step 3)" below.
   `preview_meal` wraps the same service as the doors (step 2); `log_meal` now runs that same
   read and logs its settled rows through the card's confirm path (`food-log-described.ts`), so
   what she logs is what she previewed. A row with an open question is not logged: it comes back
   to her as a fact and she asks. The waterfall stays behind both only as the labelled fallback.
4. ~~Route the meal screen's Chat / Voice / Photo doors to it; the trace UI, the assumption line,
   question rows that do not count~~ — **built 2026-11-01**, see "What was built (step 4)" below.
   Chat and Voice (`LogByChat`, the quick-log `DescribeSheet`, the plan sheet's capture) and Photo
   (`PhotoReadPanel`, inside an open meal) are on it, with the trace line, the
   assumption on the row, her question on an asked row, and the not-reached notice. _Still owed
   from this step: per-row source labels are on the wire (`source_label`) and not yet drawn._
5. ~~Write-back of her verdicts (phrase → food) so repeats get faster~~ — built in step 2
   (`food_phrases`, migration 0064): the confirm teaches it, the next read of the same words is a
   deterministic hit and no call.
6. Retire `acceptMatch` and the code-decided research trigger from the logging path. _Still in
   place behind the fallback, and behind the confirm's re-match of a row that names no food (an
   estimate, a fallback row); a row that names its food never meets them._

## What was built (step 2, 2026-11-01)

The path behind `POST /nutrition/meals/preview` (`services/food-described-meal.ts`):

1. **The split** (`food-candidate-book.ts`): comma, newline, "and", "with", "+", "&" separate
   parts; a leading amount is peeled into the lookup's measure; a menu size ("venti") stays in the
   food's words. Table-tested with the Venti latte as the pinned case (#426).
2. **The memory first** (`food-phrases.ts`, `repos/food-phrases.ts`, migration `0064`): a part
   whose words this person confirmed before is priced from the remembered food and amount by
   `priceFood`, no lookup and no call. The amount they say this time wins when the store can read
   it; a bare count ("2 eggs") takes the remembered unit; an amount the store cannot read ("a
   handful") falls back to the remembered amount — the memory never skips a part it holds. The
   model is then asked only about the parts the memory did not settle, in their words for those
   parts, and a row it writes for a remembered part anyway is dropped by its phrase key (no second
   latte). Written only on a confirm, never on a preview walked away from: the chat door
   (`logMeal({parsed})`) learns only a row the client sent with a `food_id` that the ledger then
   priced from that same food — a confirmed pick, never a name match the ledger made on its own;
   the draft door (`appendParsed`, which does not price) learns only a row whose food this person
   can see. A question row teaches nothing: it carries no link and no words. Until 0064 is
   applied a recall finds nothing and a remember logs a warning: a miss costs one call, never the
   meal.
3. **The book** (`food-candidate-sources.ts` → `fanOutFoodSources` + FatSecret's top 5 rows
   fetched in full): every record found, per-100 g numbers, the measures each offers with grams,
   the guards' notes, the fan-out's disagreements, and `incomplete` on a record with no usable
   calories (run 2's zero-kcal "Cafe Latte"). Ids are the meal's own (`c1`…); the same record seen
   twice keeps its first id; eight records shown per lookup. The FatSecret line in
   `sources_checked` is replaced with what actually ran, so the trace stays true. **The book has a
   budget of its own** (review, 2026-11-01): `text()` renders within `BOOK_BUDGET_CHARS` (12,000
   characters, sized from the ~4,800-token bar — the arithmetic is on the constant), dealing
   record lines round-robin across the parts so a long meal loses every part's last rows before
   any part loses its first; a part with rows held back says how many in its head so the model
   can ask for a narrower lookup; `shown()` answers with the records the last rendering held, and
   a pick of an id past the cut is refused as "not shown". The engine's own cap on a job variable
   (`MAX_VARIABLE_LENGTH`) was 10,000 and cut silently from the tail; #454 raised it to 40,000 and
   made a cut log the variable's name, so the budget is a cost choice, not a guard. **A record
   kept per item** (every food the old parse-meal path pinned, "1 serving = 1") is printed per its
   own measure ("per 1 serving: 250 kcal … kept per item, not by weight"), never as per 100 g of a
   count (which read 25,000 kcal), and is left out of the fan-out's per-100 g disagreement
   compare.
4. **One call, at most two** (`food-check.ts`, the `food-check` job): the words, the slot, the
   book, a `round_rule` variable (lookups offered on the first call only) and `guard_notes`
   (empty, or the previous reply's problems). The first call may ask for up to 8 more lookups;
   the second is the last and any lookups it asks for are not made. A pick not in the book, or a
   measure the record does not offer, goes back once as evidence; after the last call it becomes
   the model's estimate if it gave one, or an open row that counts nothing.
5. **The store prices** (`food-pick-portion.ts` → `priceFood`): the pick's measure times the
   count, as grams for a per-gram food or the serving for a per-item one. The row's `qty`/`unit`
   are chosen so the confirm re-prices to the same numbers (the measure's own word when it reads
   back, grams otherwise). An estimate is labelled (`basis: estimate`, "the coach's estimate") and
   carries the plain name and the brand the person named, so the confirm pins a food and not a
   sentence. **A row with an open question carries no number, no food link and no `said`**
   (review, 2026-11-01): the question is what it waits for — the card asks it, the total leaves
   it out, the coach's `preview_meal` lists it as "waiting on their answer", the guard round is
   not spent on its tentative pick, and on confirm the row re-matches by name like any row without
   a food, so a tentative pick is never logged and never taught to the memory. A linked row that arrives without an amount is not counted either, not
   from the card's number and not from a default serving.
6. **When she cannot be reached** (a provider failure, a reply that is not JSON): the old
   `parse-meal` + code-picked match prices the pending parts, every row `basis: fallback`
   ("an automatic estimate"), and the card is told (`coach.reached: false`). The remembered rows
   stay.
7. **On the wire**: each row carries `said`, `basis`, `source_label`, `assumption`, `question`,
   `problem`; the preview carries `coach: { reached, calls, checked[] }` with one trace line per
   part built from `sources_checked`. The confirm (`parsed` on `POST /nutrition/meals`, and
   `parsed` on the draft's `/items`) takes `food_id` and `said` back; a row that names its food is
   priced from it and never re-matched.
8. **The profile**: `cadence-food-check`, gpt-5.4-mini primary, claude-sonnet-5-5 failover,
   temperature 0.1 (ruling 1). Created by `scripts/provision-food-check-profile.ts` alone, which
   proves the primary with a live call after the sync; `sync-jobs.ts` then binds the job to it
   (the `<CADENCE_FOOD_CHECK_PROFILE_UUID>` token).

What stayed as it was after step 2: `log_meal` (the coach's one-call write — moved to this read
in step 3, below) and the photo door (moved in step 4, below) ran the old pipeline; `acceptMatch`
and the research trigger stay behind them and behind the fallback; `ai_log` gets a `food_check` row
per read (calls, reached, parts, remembered, records, problems).

Decided while building, for the owner to overrule:

- **Question rows are asked as an amount, and carry nothing else.** The card's only question
  mechanism is the amount chips; her question is shown on the row in her words, the row has no
  number and no food link, and once an amount is chosen the confirm re-matches the row by name.
  A question that is not about the amount ("whole or 2%?") still waits on the chips, and the
  answer the chips give is an amount, not the identity — the model's lean is never logged on the
  strength of it. Step 4 kept this: the photo door asks through the same chips.
- **A merged row is a new reading.** Folding two rows keeps the sum of their nutrients and drops
  the kept half's food link and words: the server would otherwise re-price the sum from one food
  alone and lose the other's nutrients. The merged row re-matches by name and teaches nothing.
- **The confirm trusts a link, not a number.** A row with `food_id` is re-priced from that food;
  only when the store cannot read the row's portion back does the card's own number stand, and
  that number came from the same food on the preview.
- **A renamed row keeps its food.** "Fix the name, keep the numbers" (brief 03) applies to the
  link too: renaming on the card does not re-match.
- **FatSecret is always asked on this path** (five rows per part, billed unless already fresh in
  the ledger). Ruling 6 decides whether that stays.

## What was built (step 3, 2026-11-01)

The coach's `log_meal` (`services/coach-action-log-meal.ts`) runs the same read as `preview_meal`
and the meal screen's doors, and logs through the same confirm path the card uses
(`services/food-log-described.ts`):

1. **One read, both tools.** `log_meal` by text calls `previewDescribedMeal` — the phrase memory
   first, one fan-out per part, one call to the food-check model (at most two), the store pricing
   — exactly as `preview_meal` does. The two tools can no longer price the same words differently
   (the Venti latte logged as Matcha, #426, was `log_meal` on the old waterfall beside a preview on
   the new read). `preview_meal` now says so: "log_meal runs this same read and logs what it shows".
   **The slot** is the caller's `meal`, else the slot the words name explicitly ("two eggs and
   toast for breakfast", "a salad at lunch", "Dinner: chicken" — `mealSlotInWords` in
   `@cadence/shared`, one regex with its table of positives and near-misses: "a breakfast bar",
   "lunchbox", "with dinner rolls", "brunch" name no slot), else `other`. The same rule on the
   reached path and the fallback, which is handed that slot as its hint and never contributes
   `parse-meal`'s own guess — so the same words land in the same slot whatever the provider's
   health, and the right occurrence (Breakfast, not the generic "Food log") is ticked. The phrase
   that named the slot is not food: it comes out of the words before the split (`readMealSlot`),
   so the lookups are for "a banana", not "a banana for breakfast", and the phrase memory keys on
   the same words however the slot was said; `raw_text` keeps what the person said in full.
2. **The card's confirm path writes it, after the card's own checks.** The settled rows go to
   `logMeal({ parsed })` in the card's wire shape (name, brand, amount, numbers, `food_id`, `said`
   — none of what the read noted for the card), through the SAME validator the route runs
   (`parsedMealSchema`, exported from `validation/body.ts`: at most 12 rows, a name of 80, their
   words cut at 200, an amount at most 10,000); a row that fails it is a fault that names the row
   and the rule ("items.0.qty: … 10000"), never a write. A row that names its food is priced from
   that food and never re-matched (`food-pricing.ts`), and only a confirmed pick teaches the phrase
   memory (`confirmedPickRows`). So "Starbucks venti latte" logs Caffè Latte (Venti), 250 kcal,
   the phrase is learned, and the next `log_meal` of the same words prices from the memory with no
   lookup and no call. The total handed over is the total of what is logged, not of the card.
3. **An open row is not logged, and comes back as a fact.** A row with a question ("whole or
   2%?") and a row she could not count (no record fits, no estimate given) are handed back — the
   row's name and the question, or the name and why — never logged, never the pick she leaned
   towards. (A question row's name is the model's plain name for the part when it gave one, else
   the person's words with the amount stripped — `rowsFromOutcome`; it carries no `said`.)
   On its own: `nothing changed: nothing was logged — "milk" waits on their answer: …`. Beside
   settled rows: those are logged (`changed:` lines), and the open row is an
   `unchanged:` line, with "the rest of the meal is already on their file" — a person who said
   "milk and a banana" has eaten the banana whatever the milk turns out to be. She asks in
   conversation and calls `log_meal` again with that part's words plus the answer, which lands as
   its own row at the same slot. Never a tentative pick (the "one cup of protein" lesson, kept).
4. **The answer says where every number came from, as the confirm left it.** One `changed:`
   line per logged row in the same grammar `preview_meal` uses (`food-described-render.ts`:
   amount, name, numbers, then the basis said once, in the third person — "a record the coach
   picked, priced from USDA" / "from their saved food", "what they picked before, priced from that
   food", "the coach's own estimate", "an automatic estimate, the coach not reached" — the
   assumption, and why a row counted nothing; never the card's "your saved food"), a total line
   when more than one row logged, and the `changed:` / `nothing changed:` / fault contract
   throughout (`coach-action-contract.test.ts`). The rows are read back from the write: an
   estimate or fallback row the read left unlinked that the confirm then matched by name and
   priced from a food is told as "priced from a food the store matched by name (Yogurt parfait),
   not the coach's estimate" — the store's number, not hers. **Parts the split did not read** are
   said too: past the cap of 10 ("\"berries\" not read — the read takes at most 10 parts") or said
   twice ("\"latte\" said twice, read once"), as `unchanged:` lines here, as `Not read:` lines on
   `preview_meal`, and on the wire as `coach.not_read` for the card.
5. **When she cannot be reached**, the fallback's rows log as before — every row "an automatic
   estimate, the coach not reached" — and the answer says the food-check model could not be
   reached. A fallback the confirm marks provisional is told as unsettled, as before. A read that
   fails past its fallback, or a write that throws, is a fault, never "nothing".
6. **The same words previewed a moment ago run the read again.** A preview writes nothing, and the
   words can change between the two calls (a size named, a detail added). The repeat costs one
   food-check call, once: the confirm then teaches the memory, and the next time those words price
   from it with no call at all. A cache keyed on the words would save that one call and add a
   staleness rule nobody has measured a need for, so none is built. What would change this: a
   measured run showing preview-then-log pairs are common AND the second read disagrees with the
   first often enough to matter (the model runs at temperature 0.1 on the same book, so a
   disagreement should be rare; the answer names the pick, so she can see one).

Tests: `coach-action-log-meal.test.ts` runs the action through the `DescribedMealDeps` seam with
the write faked at the service boundary — a picked row logs and `confirmedPickRows` keeps it, a
pre-seeded memory makes no call, a remembered row beside a model row (one call, order kept, the
duplicate dropped), an estimate logs labelled and teaches nothing, an estimate the confirm matched
by name is told as that, an estimate with a problem is logged, a question row logs nothing and
comes back, a settled row beside it is logged, an uncountable part comes back with why, the slot
rule on both paths, an eleventh part and a repeated part are said, words cut at 200 and an amount
over the cap a fault, the fallback logs labelled and says so (and PROVISIONAL with no numbers),
faults are faults, bad calls never reach the read. `food-described-render.test.ts` pins one line
per basis exactly; `meal-slot-words.test.ts` (shared) is the slot regex's table; the split's
report is in `food-candidate-book.test.ts`.

What stayed as it was after step 3: the photo door (`parse-meal-description` priced the reading —
moved to this read in step 4, below); `acceptMatch` and the research trigger behind the fallback
and the confirm's re-match of a row that names no food; `POST /nutrition/meals` with bare `text`
(no caller in the web client today; the coach's tool no longer uses it).

Decided while building, for the owner to overrule:

- **An open row is held back per row, not per meal.** The alternative — log nothing while any
  part has a question — would make her repeat the whole meal and run the read again for the parts
  that were settled (not yet learned, since nothing was confirmed). Per row, the settled parts are
  on the file at once and the answered part follows as its own row at the same slot. The day
  then shows two rows under one slot for that meal, which the Food screen already handles for
  any two quick-adds.
- **A meal whose words name no slot is filed under "other".** The old path let `parse-meal`
  guess the slot from the words alone; the coach-led read takes the slot as an input, and the
  only guess made now is the explicit one (`mealSlotInWords`: a preposition or a leading "Slot:"
  in front of the slot word). The tool's description tells her to pass the meal when known. A
  time-of-day default would need the person's timezone and a new rule with its own table test —
  not built until asked for.
- **`log_meal`'s description changed** (the always-on list): it now says the read is the one
  `preview_meal` runs, that a part needing an answer is not logged and its question comes back,
  and that an unnamed meal takes the slot the words name, else "other". 797 characters, inside
  the 800-character action bound. `eval:tools` is the owner's call. `preview_meal`'s description
  and its `meal` parameter say the same slot rule (513 of 520).

## What was built (step 4, 2026-11-01)

The photo door reads the way the typed one does (`services/meal-photo-read.ts`, the web's
`PhotoReadPanel`):

1. **The reading is plain text, and ends with a list.** The `describe-meal-photo` job now asks for
   a few plain sentences for the person (what it is, what the size was anchored to, what it could
   not tell), a blank line, then one line per food or drink with the amount first and the brand on
   the line — "1 venti Starbucks latte" — and nothing after it; the qualifiers go before the food
   ("1 venti oat milk latte"), no commas, "and", "with" or "&" inside a line, because each line is
   one part to the split. No asterisks, no bold, no headings, no bullet marks (the owner found
   "***" and "**Compact Summary for Data Entry:**" in the editable box, 2026-10-31).
   `describe-meal-photo-job-config.test.ts` pins the rules and runs the prompt's own example list
   through the split. The read also takes off any markdown a model writes anyway
   (`plainReading`), so the box never shows it. **The prompt is not live until
   `scripts/sync-jobs.ts` runs.**
2. **The list is read by shape, from the bottom.** `readingWords` does not trust the order the
   prompt asks for: a line reads as a food when it starts with an amount the split can peel
   ("1 venti…", "150 g…", "half a…") or is a short line starting with a number word that does not
   end like a sentence ("a banana", "two eggs"); from the bottom, lines that are not foods (a
   closing sentence, a sign-off) are skipped, the run of lines up to the blank above is the list,
   and a non-food line inside that run (the old prompt's "Compact Summary" heading, prose left in
   when the blank line is deleted) is skipped too. The sentences above the blank are the eyes'
   notes: shown in the box, kept on the row as `photo_reading`, never looked up — and handed to
   the food-check call as its `notes` variable (at most NOTES_MAX, 500 characters; a cut is said
   in the trace), so a doubt the eyes named becomes her question or her stated assumption for
   that part (owner, 2026-11-01: "if it can't tell whole or skim milk, it should ask the user").
   The job's prompt defines `<notes>` in one sentence of facts, not picks. **Nothing is dropped
   quietly**: every skipped line, and every line past MAX_PARTS or past PHOTO_WORDS_MAX (the
   door's own cap — a reading runs past the typed path's 500; whole lines, never a cut mid-word),
   joins the split's own `coach.not_read` and the card says "Not read: …". An empty
   reading reads the caption (the read failed, the person went on from their words); no food line
   and no caption is a 400 that says the shape, never an empty card. The raw model output is what
   the log keeps (`markdown_stripped` flags a tidy), so the leak stays visible.
3. **The same read.** `previewMealFromReading` hands the words to `previewDescribedMeal`: the
   phrase memory, the book, one `food-check` call, the store's pricing, the labelled fallback — so
   a photo of a latte and a banana gives the rows, the trace and the numbers that typing "1 venti
   Starbucks latte, 1 medium banana" gives (`meal-photo-read.test.ts` asserts the two previews
   equal through the `DescribedMealDeps` seam, notes aside). The `food_check` log row is marked
   `photo: true` and carries the notes, whether they were cut, and the lines not read.
4. **The same card.** `PhotoReadPanel` renders the chat door's own line (`CoachReadLine`: she
   could not be reached → the notice with the tap hint; she read it → "Here's what I found"; no
   coach block → the same line), her trace, the lines not read, and `MealParseCard` (→
   `MealAmountRows`, `useMealAmounts`). **The one live door is the quick log's, inside an open
   meal** (`meal/MealDoors.tsx`, draft mode): the card's button adds the rows AND the photo with
   its reading to the meal. A question row asks through the chips in her words and counts nothing
   until answered — whatever number rides on it, on the card as on the quick-log sheet. Every
   fault is told in plain words with a way forward (`photoReadCopy.ts`): the eyes could not read
   the photo → the box opens empty with the caption still counting; the read could not be worked
   out → "Back to the reading" keeps every correction; a call past its bound (90 s for the eyes,
   120 s for the read) is told so; Back is never disabled and leaving aborts what is in flight.
   The stage-2 progress copy (`NUTRITION_STEPS`) narrates the read, not a write.
5. **The confirm keeps the photo.** The draft's add (`POST /nutrition/meals/:id/items`: `parsed`
   with `photo_ref` and `photo_reading`) puts the picture and the reading on the open meal in the
   same statement as the rows, so neither lands without the other: the meal's FIRST photo stays
   (the day's thumbnail must not change under the person as they add) and every reading is
   appended after a blank line. `POST /nutrition/meals` `parsed` takes the same two fields for a
   log-mode host (none is mounted today); that row lands as `input_method: 'photo'`. A `photo_ref`
   that is not `${userId}/…` is refused before anything is priced or written, on every door
   including the old `/photo/log`. Each row's `food_id` and `said` teach the phrase memory as on
   the typed door; `said` is capped at 200 where the split makes it, so the key the memory was
   asked with is the key the confirm teaches.
6. **Left as it was, to go with the next phone rebuild:** `POST /nutrition/photo/log` and
   `logMealFromReading` (the old one-call write) stay for clients built before this change;
   `parse-meal-description` is referenced there and by `scripts/eval-food-vision.ts`. The plan's
   photo host (`MealCapturePhoto`) had no caller and was deleted with its test; log mode on
   `PhotoReadPanel` stays for a future host and is tested.

Decided while building step 4, for the owner to overrule:

- **The list-line rule.** A reading's foods are the lines that start with an amount (or a short
  number-word line); everything else in or after the list is reported, not looked up. A line
  typed by hand as "banana" is reported until it says "1 banana" — visible on the card, one edit
  away — rather than guessed at.
- ~~**The eyes' sentences do not reach the coach.**~~ Ruled the same day (owner, 2026-11-01: "If
  it can't tell whole or skim milk, it should ask the user"): they reach her as the food-check
  call's `notes`, bounded at 500 characters, the prompt's definition a sentence of facts. The
  photo prompt's item 6 keeps its promise, worded to what is now true.
- **`/photo/log` is kept** for clients built before this change; it runs the old write and goes
  with the next rebuild.
- **The caption is no longer stored as `raw_text`.** The words read (the list) are; the caption
  reached the eyes and is folded into the reading. An empty reading reads the caption, and then
  the caption is the words.
- **First photo wins on a meal; readings accumulate** (above, 5).
