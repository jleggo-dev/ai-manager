# Spec — FatSecret, and whether we need it

**Opened 2026-08-22. Status: RESEARCHED, not built.** Supersedes the FatSecret bullet in
[`DESIGN-consistent-ledger.md`](DESIGN-consistent-ledger.md) §4, which assumed OAuth 2.0 and a
storable reference row. Both assumptions were wrong in instructive ways.

Sources: FatSecret's own docs — [storable data](https://platform.fatsecret.com/docs/guides/storable-data),
[editions](https://platform.fatsecret.com/api-editions), [guides index](https://platform.fatsecret.com/docs/guides),
[NLP](https://platform.fatsecret.com/docs/v1/natural.language.processing),
[image recognition](https://platform.fatsecret.com/docs/v2/image.recognition).

---

## The headline: their storage rule fits our ledger better than expected

The Developer ToS says you **"may not cache any user data for more than 24 hours, with the
exception of information that is explicitly 'storable indefinitely'"**. That list is short, and
almost all of it is identifiers:

> `auth_secret`, `auth_token`, `exercise_id`, `food_category_id`, `food_entry_id`, **`food_id`**,
> `recipe_id`, `recipe_types`, `saved_meal_id`, `saved_meal_item_id`, **`serving_id`**

Food **names**, **brands** and every **nutrient value** are therefore 24-hour data.

At first reading that kills the A23 ledger for FatSecret foods: our consistency promise is "price
it once, store the number, reuse it forever", and this forbids storing the number.

**It does not, and the reason is the whole point of A23.** Consistency was never really about
caching a value — it is about *asking the same question every time*. `food_id` and `serving_id`
are exactly the two things we are allowed to keep forever, and they are exactly the two things that
determine the answer. Pin the reference, re-read the numbers, and the parfait still costs the same
every day, because it is the same row of theirs being read.

That is a genuinely good fit, and it is worth noticing that their permitted-storage list reads
almost like it was designed for this pattern.

### What that means concretely

| | Store | Refresh |
|---|---|---|
| `fatsecret_food_id`, `fatsecret_serving_id` | **indefinitely** | never |
| name, brand, serving labels | ≤ 24 h | on read |
| all nutrients | ≤ 24 h | on read |

A `cadence.foods` row backed by FatSecret is therefore a **pointer plus a 24-hour cache**, not a
food. It needs a `fetched_at` and a refresh-on-read path, and it must degrade honestly when the
refresh fails.

**Open question worth an email, not a guess:** the rule says "user *data*", and the storable list
mixes end-user objects (`food_entry_id`, `auth_token`) with database objects (`food_id`). Whether a
*logged meal's* nutrient snapshot counts as our cache of their database or as the user's own diary
entry is a licensing call, not an engineering one. Design for the conservative reading; ask.

## The tier situation, which changes the economics

| | Basic | **Premier Free** | Premier |
|---|---|---|---|
| Calls | 5,000/day | **Unlimited** | Unlimited |
| Datasets | US only | US only | 58+ countries |
| Attribution | **required** | **required** | not required |
| Cost | free | **free, with verification** | on request |

**Premier Free eligibility, verbatim:** *"Start-ups meaning a company earning less than US$1
million in annual revenue and having raised less than US$1 million in funding"* — also non-profits
and students.

Cadence qualifies. **Recommendation: apply for Premier Free before writing another line of client
code.** It is the same data as Basic with the daily cap removed, and 5,000 calls/day is not a lot
when every pricing of a FatSecret-backed food is a fresh call by policy.

**Attribution is required on both free tiers.** That is a UI obligation, not a footnote — design
needs to know before it draws a food detail screen.

### Cost is not per call, which cuts against the hoped-for saving

> "Pricing is based on the number of markets you would like to access… FatSecret does not provide
> volume pricing per API calls."

So the intuition that a call-based vendor would be cheaper than paying an LLM per token does not
apply here: the base API is *free* at our size, and the AI features are **separately billed add-ons
at undisclosed prices**. There is no per-call number to compare against tokens. That has to come
from a sales conversation.

## Rate limits, measured

| Source | Limit | Scope | Signalled how |
|---|---|---|---|
| **FatSecret Basic** | **5,000 calls/day** | the whole app, not per user | error **code 11**, as HTTP **200** |
| **FatSecret Premier Free** | unlimited | — | — |
| **USDA** (api.data.gov) | **3,600 requests/hour** | the whole app | HTTP 429 + `x-ratelimit-*` headers |
| **Open Food Facts** | browser-driven | the user's own device | does not pool against us |

USDA's figure is measured from a live `x-ratelimit-limit` header rather than quoted from docs.

**The trap, and it cost a fix:** FatSecret reports throttling as **HTTP 200 with an error body** —
code 11 *"Application request limit reached"* (the daily cap) and code 12 *"User is performing too
many actions"*. Neither reaches a `res.status === 429` check, so a client watching only the status
keeps calling for the rest of the day after exhausting its quota. Both codes now trigger the
cooldown; the daily one takes the longest we allow, because it resets on their clock and a short
retry is a wasted call.

Also worth noting: **code 21 is "Invalid IP address detected"** — the allowlist OAuth 2.0 would
have required, and the reason we sign with 1.0.

### What we will actually spend

FatSecret is the last rung, so it only fires when the ledger AND USDA both miss. Discovering a new
branded food costs **2 calls** (a search plus a `food.get.v4`); after that the shared row answers.
The 24-hour rule then costs **one refresh per distinct food per day it is eaten** — and because
those rows are shared, that cost does not multiply by users. Two people logging the same latte pay
for one refresh between them.

So 5,000/day binds at roughly *thousands of distinct branded foods logged per day*, not thousands
of users. Comfortable at our size, and Premier Free removes the ceiling anyway.

## Are they just doing what we are doing?

Partly — and the difference is the part that matters.

### NLP (`natural.language.processing`) — Premium add-on

Free text in ("toast with ham and cheese, an apple, a banana and a cappuccino"), matched foods out,
with parsed quantities and full nutrition. It handles multiple items, distinguishes generic from
branded, and takes an `eaten_foods` array to bias matching toward what this person eats — which is
their version of our rhythm ranking.

**This is our `parse_meal` + resolver + `estimate_food`, with one decisive difference: it resolves
against a curated database rather than a language model's memory, so every hit comes back with a
`food_id` we may keep forever.** Our LLM fallback produces a number nobody can check; theirs
produces a reference. On provenance, that is strictly better.

Where it will not help: it cannot know the yogurt parfait from a café near your office. No database
can. That case stays ours, and pinning an estimate remains the right answer for it.

### Image recognition (`image.recognition`) — Premium add-on

Foods and portion sizes from a photo, with nutrition per detected portion. Base64, ≤1.09 MB,
256×256 or 512×512 recommended, and an optional `eaten_foods` hint.

**It explicitly refuses the case that started this whole thread:** *"Nutrition labels ignored by
design"* — a photo of a nutrition facts panel returns error 211. Our `parse_nutrition_label` job
covers exactly what theirs declines, so this is a **supplement, never a replacement**.

Worth noting they arrive at our own conclusion independently: their docs recommend *"implementing a
review screen allowing users to adjust suggested servings before logging entries."* That is the fix
we shipped this week.

### Discrepancy to resolve

The guides index marks barcode lookup, autocomplete and `foods.search` v5 as Premier-exclusive,
while the editions page lists barcode scanning and autocomplete as included in all tiers. Probably
a versioning distinction (v2/v5 endpoints vs older ones). **Confirm before depending on either.**

## Recommendations

1. **Apply for Premier Free now.** Free, unlimited, and we qualify. Nothing else should be decided
   first, because the daily cap is the thing that would shape the architecture.
2. **Build the base integration as pointer + 24-hour cache.** Store `food_id`/`serving_id`
   indefinitely, everything else with a `fetched_at`. Consistency comes from the stable reference.
3. **Do not adopt NLP or image recognition yet.** Both are separately billed add-ons of unknown
   cost, and both are strongest exactly where we are already adequate (common foods) while silent
   where we hurt (local businesses). Get the price, then decide against a measured baseline —
   `npm run metrics:food-ledger` exists for precisely this.
4. **Keep our label-photo path regardless.** Their image recognition rejects nutrition panels by
   design, so that path has no substitute.
5. **Ask them four things** in one email: the Premier Free application; whether a logged meal's
   nutrient snapshot counts as cacheable user diary data; add-on pricing for NLP and image
   recognition; and the barcode/autocomplete tier discrepancy above.
6. **USDA Branded first.** It is public domain, cacheable forever, needs no vendor conversation, and
   covers packaged goods — the class that broke. FatSecret's real edge is *restaurant* food, which
   is a narrower gap than it first appeared.

## Build order, once Premier Free is confirmed

Already written and unblocked: `fatsecret-http.ts` (OAuth 1.0, signed, rate-limited) and
`fatsecret-map.ts` (pure mapping, nutrients-per-serving → per-base).

Still to do: migration for `fatsecret_id` + `fetched_at`, the endpoint layer (**v4**), refresh-on-read
in the pricing path, attribution in the UI, and the resolver gate.

**Ordering, ruled by the owner 2026-08-22:** FatSecret is the LAST rung in the series. The local
ledger always wins first; then USDA for whole foods; then FatSecret. NLP and image recognition are
not adopted for now.

### The endpoint version is a correctness issue, not a preference

Corrected 2026-08-22 after the owner pushed back on an over-cautious first pass. Both readings were
true, of different versions:

- **`food.get` v1 (deprecated):** *"Percentage of daily recommended Calcium, based on a 2000 calorie
  diet"* — calcium, iron, vitamin A and vitamin C are all **percentages**.
- **`food.get.v4` (current):** *"Calcium content in milligrams"* — the same field names are
  **absolute amounts**.

So the hazard is real and the fix is not to skip them: **pin v4 and map them.** Pointing the mapper
at v1 would read 6 %DV of iron as 6 mg — a tenfold error in a number nobody double-checks. The
warning lives on `nutrientsFromServing` so nobody wires the older endpoint later.

Mapped from v4: kcal, protein, carbs, fat, fibre, sodium, potassium, **calcium, iron, vitamin C** —
ten of Cadence's twelve. **Zinc and B12 are absent because FatSecret does not return them**; those
stay the preserve of USDA and label photos, and their absence is honest rather than a guessed zero.
