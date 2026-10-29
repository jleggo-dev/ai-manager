# Handoff: Cadence — Quick log (the meal drawer, simplified)

Exported from the "Cadence app design request" Claude Design project on 2026-10-28, from the
owner's "too much to read" steer on the shipped meal drawer (`features/food/meal/`).

## What it is

The meal drawer, redrawn as a **shelf of your foods, not a form**. One sentence: tap what you ate.

- **Cut** — the OPEN pill · ‹ back (swipe the drawer down instead) · the "change ⌄" hint (the
  title IS the picker) · the window line · the empty-state paragraph · tile labels under the
  doors · the express-lane link · photos on tiles (no library covers every food; words + kcal
  are faster to scan).
- **Kept** — day macros on top, now previewing the cart as a hatched segment before you log ·
  the five doors, icon-only (Find first) · one button: **Log breakfast · kcal**.
- **New** — four shelves, one tap each: **Planned** (absent — not greyed — when the week names
  nothing for this slot) · **Usual** (opens here) · **Leftovers** (recipes cooked in multiples,
  still fresh) · **Cookbook**. Two-column tiles, ~14 above the fold, the list scrolls on without
  end. Tap = +1 default serving (badge) · tap again = ×2 · hold = the amount sheet (1b) · × on a
  chip removes. No row ever opens a form on first tap.

## Rules & calls (from the canvas)

- **Which shelf opens** — Planned if the week names a dish for this slot, else Usual.
- **What "Usual" ranks on** — foods and one-portion recipes logged at this slot, most-often
  first, recency as tiebreak (`useUsualAtSlot`). No kind markers — the shelf you're on already
  says what these are.
- **Leftovers** — ~~any logged recipe with yield > 1 in the last 4 days, "2 of 4 left · Mon"~~
  superseded 2026-10-28 (see below): meals logged recently, most recent at the top.
- **The amount sheet (1b)** — only when the default isn't right. Chips come from
  `servingPicker` (volume leads for produce, printed weight for brands), so most foods never
  open it.
- **Advice lives elsewhere** — one door: Cadence's face in the title row opens the coach,
  scoped to this meal; the cart (or what was logged) is already in her context. Nothing else on
  this drawer talks. The hatched preview on the macros is the only "advice" — and it's just
  arithmetic.
- **Open forks the canvas left** — two columns (shown) vs one denser list · whether Cookbook
  merges into Usual once it ranks well · whether Find should autofocus when every shelf is
  empty (first week).

## Decisions taken at implementation (owner, 2026-10-28)

- The face hops to the **Coach tab** with an app-authored note (which meal, what's in the cart
  or what was logged, and a pointer to `get_food_log` / `get_nutrition` / her goals context) —
  the app has one coach, not an in-drawer chat.
- **No Undo** after logging — entries can already be deleted from the day.
- **Leftovers = meals logged recently** (owner, 2026-10-28, replacing the canvas's batch/yield
  reading): logged meals in the window, newest first, the later slot first within a day; one
  tile per meal ("Lentil stew · Side salad", "yesterday · dinner"), a repeat shown once. Tap puts
  that meal's rows back in the cart priced as logged, its named brackets redrawn; no hold. The
  window is seven days by default, 3 / 7 / 14 in Settings → Nutrition (device-local, user-scoped).
- **P / C / F on this surface** (owner, 2026-10-28) — the day bars' labels and a
  "P 12 · C 30 · F 8" line on each tile. A scoped exception to BRAND.md's abbreviation rule.
- **Hold is findable** (owner, 2026-10-28) — a pressed tile sinks and, if it can be held, fills
  toward the hold; the hold landing ticks a haptic (Capacitor Haptics on iOS, `navigator.vibrate`
  on the web); a one-time line "Hold a tile to choose how much." until the first hold.
- This **replaces** the shipped meal screen in both hosts (the trail's capture sheet and the
  Food screen); it is a redesign of the one quick-log surface, not a second one.

## About the design files

`Cadence Quick Log.dc.html` is a design reference prototype written in HTML, not production
code. It runs on the in-house template runtime (`support.js` — reference only, do not port) and
is here so you can open it, click through it, and read exact values out of it. `ios-frame.jsx`
is a desktop preview bezel only. Inside the HTML, the sample data and the prototype's state live
in the `<script data-dc-script>` block at the bottom; everything visual is inline-styled above
it. The `hasPlanned` tweak toggles the Planned shelf.

Fidelity is high: colors (oklch), type sizes, spacing and radii are final-intent. Recreate them
through the codebase's own primitives (the `.ms-*` family in `styles/meal-screen.css`, the
`MethodTiles` doors, `NutritionRing`, `CoachFace`) rather than one-off styles.
