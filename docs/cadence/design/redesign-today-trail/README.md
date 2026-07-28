# Handoff: Cadence — Today trail, Week view, task walkthrough

## Overview

A redesign of Cadence's daily surface. The user's AI coach proposes tasks toward long-term goals; the Today tab presents them as a **continuous, scrollable trail of days**, each day drawn as a sky that moves dawn → midday → dusk → night. Task order is chronological but **nothing is locked** — any task can be started at any time, and the user can log activities the coach never suggested.

Key concepts to preserve:

1. **Time of day is the color system.** A task's node color comes from its position in the day (warm orange in the morning → sky blue at midday → deep blue at night), not from its category.
2. **Vibrancy means engagement.** Untouched tasks are desaturated; a task only becomes vibrant once it's been started or completed. There is no "up next" highlight and no pulsing — order is the user's choice.
3. **Weather adapts the plan.** The header alternates between a greeting and the current conditions; outdoor tasks affected by weather offer an indoor alternative before starting.
4. **Playful, physical buttons.** Nodes are ovaloid "pressable disc" shapes with a light gradient face, a specular sheen, and a hard bottom edge that reads as thickness.

## About the design files

`Cadence Redesign.dc.html` is a **design reference prototype written in HTML**, not production code. It runs on a small in-house template runtime (`support.js`) and is only here so you can open it, click through it, and read exact values out of it.

The task is to **recreate these screens in the Cadence codebase's own environment** (React Native / SwiftUI / whatever the app already uses), following its existing component patterns, navigation, and state layer. Do not port the HTML, the template syntax, or `support.js`. If no client environment exists yet, choose the framework appropriate for the product and build the designs there.

`ios-frame.jsx` is only a preview bezel for viewing the design on a desktop browser — it is not part of the design.

## Fidelity

**High-fidelity.** Colors, type sizes, spacing, radii, shadows, copy, and interaction behavior are all final-intent and specified below. Recreate them closely, but express them through the codebase's existing primitives (theme tokens, button components, sheet/modal components) rather than one-off styles.

All colors are authored in **oklch**. Every value below is given as authored; convert to the codebase's color format. Where a hex is useful, convert — do not eyeball from screenshots.

---

## Screens / views

### 1. Today (default tab)

**Purpose.** See the whole rhythm of today and the next couple of days; start any task; talk to the coach; log something off-plan.

**Layout (390×844 iPhone frame).**

- Root: full-height column, background `oklch(96% 0.025 76)` (warm cream, dawn-tinted).
- **Header** — `padding: 54px 20px 4px` (the top 54px clears the status bar / Dynamic Island), `display:flex`, `space-between`, `align-items:center`.
  - Left: 36×36 circular avatar, background `oklch(78% 0.16 64)`, hard bottom edge `box-shadow: 0 3px 0 oklch(62% 0.15 60)`, containing a 21px solid-white filled leaf mark (the Cadence glyph). Beside it, a 34px-min-height text block that **cross-fades between two states** (see Interactions):
    - Greeting: "Good morning" — 13.5px / 800 / `oklch(34% 0.02 150)`; sub-line "SUN 26 JUL" — 10.5px / 700 / `letter-spacing:0.04em` / `oklch(58% 0.02 120)`.
    - Weather: 17px rain glyph (stroke `oklch(48% 0.07 250)`) + "Cold & rainy · 4°" — 13.5px / 800 / `oklch(40% 0.06 250)`; sub-line "INDOOR SWAP READY" — 10.5px / 700 / `oklch(50% 0.07 250)`.
  - Right: two pills, `padding:5px 10px`, `border-radius:999px`, 4px gap between glyph and number, number 13px / 800.
    - Streak: background `oklch(90% 0.03 40)`, 16px flame glyph stroked `oklch(45% 0.13 45)`, text `oklch(35% 0.1 40)`, value `12`.
    - XP: background `oklch(90% 0.05 95)`, 16px star glyph stroked `oklch(45% 0.12 92)`, text `oklch(38% 0.11 95)`, value `40`.
- **Tab switcher** — `margin: 12px 20px 14px`, two equal buttons, 8px gap, `border-radius:14px`, `padding:11px 0`, 14px / 900.
  - Active: background `oklch(78% 0.16 64)`, text `oklch(29% 0.08 55)`, `box-shadow: 0 4px 0 oklch(62% 0.15 60)`.
  - Inactive: background `oklch(92% 0.04 66)`, text `oklch(56% 0.07 60)`, `box-shadow: 0 3px 0 oklch(86% 0.04 62)`.
- **Scroll area** — fills remaining height, vertical scroll, **scrollbar hidden** (`scrollbar-width:none` + zero-size webkit scrollbar). Contains, in order: coach note card, one section per day, then the detour footer.
- **Coach note card** — white, `border-radius:18px`, `padding:14px 16px`, 10px gap, `box-shadow: 0 1px 3px oklch(0% 0 0 / 0.04)`, `margin-bottom:18px`, inside 20px side padding. 22px chat glyph stroked `oklch(50% 0.07 152)`; body 13px / `line-height:1.4` / `oklch(35% 0.02 150)`, in quotes. Copy: *"It's 4° and raining — I've lined up an indoor swap for your run. Everything else is just a suggestion."*
- **Day section** — `position:relative`, `padding: 0 20px 30px`, `overflow:hidden`. Contains an absolutely-positioned sky layer, decorative celestial layers, a day label row, the coach bay, and the node list.
  - **Sky, first day** — `linear-gradient(to bottom, oklch(95% 0.04 68) 0%, oklch(96% 0.035 88) 16%, oklch(95% 0.03 210) 36%, oklch(84% 0.06 245) 56%, oklch(58% 0.11 285) 74%, oklch(33% 0.08 272) 88%, oklch(23% 0.06 268) 100%)`, plus a sun glow: 120×120 circle at `top:36px; right:-26px`, `radial-gradient(circle, oklch(93% 0.14 88) 0%, oklch(93% 0.14 88 / 0.45) 55%, transparent 72%)`.
  - **Sky, every later day (sunrise-led)** — starts in night and breaks into dawn so the boundary between days reads as a sunrise: `linear-gradient(to bottom, oklch(23% 0.06 266) 0%, oklch(30% 0.09 292) 4%, oklch(48% 0.13 20) 8%, oklch(74% 0.14 46) 13%, oklch(92% 0.07 66) 19%, oklch(96% 0.035 88) 30%, oklch(95% 0.03 210) 46%, oklch(84% 0.06 245) 62%, oklch(58% 0.11 285) 78%, oklch(33% 0.08 272) 91%, oklch(23% 0.06 268) 100%)`. Over it: a 230×120 horizon glow centered at `top:5%` (`radial-gradient(ellipse, oklch(97% 0.12 72) 0%, oklch(92% 0.14 56 / 0.5) 45%, transparent 75%)`) and a 78×78 sun disc centered at `top:12.5%` (`radial-gradient(circle, oklch(99% 0.06 88) 0%, oklch(95% 0.13 72) 60%, transparent 78%)`). Later days also carry a 96px spacer above the label so the sunrise has room.
  - **Night stars** — in the bottom 34% of each section, six 2–4px white dots at (16%,22%), (72%,8%), (44%,38%), (86%,52%), (28%,66%), (62%,78%), each twinkling on its own 2.8–4.6s cycle (opacity 0.25 → 0.9 → 0.25).
  - **Day label row** — `padding:18px 0 22px`, a 1px rule on each side (`oklch(62% 0.04 62 / 0.35)`) with centered text 10.5px / 900 / `letter-spacing:0.12em` / `oklch(44% 0.06 58)`. Labels: "TODAY · SUN 26 JUL", "TOMORROW · MON 27 JUL", "TUE 28 JUL".
  - **Node list** — one row per task, each row `margin-bottom:30px`, contents centered then translated horizontally by that node's crescent offset (below).
  - **Coach bay** — see "Coach affordance".
- **Detour footer** — full-width block, background `oklch(23% 0.05 262)` (continues the last night), `padding: 0 20px 150px` (the deep bottom padding clears the tab bar). Contains a dashed link: `border:1.5px dashed oklch(45% 0.07 268)`, `border-radius:16px`, `padding:14px`, text 13px / 700 / `oklch(88% 0.03 268)`, centered — "Life happened? Take a detour". Opens the log sheet.
- **Floating log button** — 56×56 circle, `right:18px; bottom:98px`, background `oklch(66% 0.14 258)`, `box-shadow: 0 6px 0 oklch(50% 0.14 260), 0 10px 18px oklch(20% 0.06 265 / 0.35)`, white `＋` at 26px. Above the tab bar in stacking order.
- **Tab bar** — pinned bottom, white, `border-top:1px solid oklch(90% 0.015 95)`, `padding:8px 4px 22px`, four equal items, each a 20px glyph over a 10.5px label. **Must paint above the scrolling trail** (the trail rows create their own stacking level; give the bar an explicit higher z-index).
  - Active (Today): glyph and label `oklch(42% 0.06 152)`, glyph sitting on a `oklch(93% 0.02 152)` pill (`border-radius:12px`, `padding:5px 16px`), label 800.
  - Inactive (Coach, Food, Progress): `oklch(62% 0.01 152)` glyph, `oklch(58% 0.01 152)` label at 700.
  - Glyphs match the existing app: calendar, magnifier, fork-and-knife, bar chart.

#### The task node (the core component)

Each node is a **wrapper 104×112** containing an optional step ring and the disc, with the label beneath (11px gap).

- **Disc** — 82 wide × 74 tall, `border-radius:50%` (an ovaloid, deliberately wider than tall so it reads as lying down and pressable), `overflow:hidden`, `position:relative`.
  - Face: `linear-gradient(168deg, <light> 0%, <main> 52%)`.
  - Thickness + ground: `box-shadow: 0 8px 0 <deep>, 0 13px 18px oklch(25% 0.05 265 / 0.20)`.
  - Specular sheen: a pseudo-element ellipse 38×17 at `top:7px; left:12px`, `background: oklch(100% 0 0 / 0.34)`, `border-radius:50%`, `transform: rotate(-16deg)`.
  - Icon: 36px **solid white** glyph, centered (filled silhouettes, not line icons): sun for mindset, running figure for movement, apple for nutrition, moon for reflection.
  - Completed badge: 26×26 circle at `bottom:-4px; right:-6px`, background `oklch(97% 0.01 265)`, check in `oklch(40% 0.07 265)` at 14px / 900, `box-shadow: 0 3px 0 oklch(80% 0.02 265)`.
- **Step ring** — only when the task has **more than one step**. An SVG circle, `cx:52 cy:60 r:49` in a 104×112 box, `stroke-width:5`, `stroke-linecap:round`, rotated −90° about its own center so the first segment starts at 12 o'clock. Segments come from `pathLength="100"` with `stroke-dasharray: "<100/steps − 4> 4"` — one arc per step with a 4-unit gap. This yields an even ~8px gap between ring and disc on every edge, including below the 8px bottom edge. Ring color: `oklch(78% 0.02 250)` over daylight sky, `oklch(52% 0.03 262)` over night sky.
- **Label** — centered under the disc. Title 13px / 800 / `max-width:140px` / `line-height:1.25` / `text-wrap:pretty`. Meta line ("07:00 · 5 min") 11px / 700, 2px above. Over daylight sky: title `oklch(30% 0.04 250)`, meta `oklch(48% 0.03 250)`. Over night sky: title `oklch(97% 0.01 265)`, meta `oklch(80% 0.03 265)`.
- **Weather-swap pill** (only on the affected task, only for today) — inline pill under the meta line, `margin-top:5px`, background `oklch(93% 0.03 250)`, `border-radius:999px`, `padding:3px 8px`, 11px swap-arrows glyph stroked `oklch(45% 0.08 250)`, text "INDOOR SWAP" 9.5px / 900 / `letter-spacing:0.04em` / `oklch(42% 0.08 250)`.

#### Node state → color (important)

Two states only:

- **Untouched** (never started): muted face — `linear-gradient(168deg, <mLight> 0%, <mMain> 52%)`, bottom edge `<mDeep>`.
- **Started or completed**: vibrant face — `linear-gradient(168deg, <light> 0%, <main> 52%)`, bottom edge `<deep>`. Completed additionally shows the check badge and inverts the gradient direction (`main → deep`).

No glow, no pulse, no "next" emphasis — every task is equally available.

#### Time-of-day tone ramp

A day's tasks are spread across a six-stop ramp: index `round(i / (n − 1) × 5)` where `i` is the task's position in that day and `n` the day's task count. So each day always begins at dawn and ends at night regardless of how many tasks it holds.

| # | main | light | deep | muted light | muted main | muted deep | dark sky? |
|---|---|---|---|---|---|---|---|
| 1 dawn | `oklch(76% 0.15 55)` | `oklch(87% 0.11 62)` | `oklch(60% 0.14 52)` | `oklch(77% 0.04 62)` | `oklch(68% 0.04 58)` | `oklch(57% 0.04 55)` | no |
| 2 morning | `oklch(79% 0.16 70)` | `oklch(89% 0.12 78)` | `oklch(63% 0.15 68)` | `oklch(78% 0.04 76)` | `oklch(69% 0.04 70)` | `oklch(58% 0.04 68)` | no |
| 3 late morning | `oklch(84% 0.15 90)` | `oklch(93% 0.10 94)` | `oklch(69% 0.14 86)` | `oklch(79% 0.04 92)` | `oklch(70% 0.04 88)` | `oklch(59% 0.04 86)` | no |
| 4 midday | `oklch(76% 0.12 212)` | `oklch(88% 0.08 208)` | `oklch(61% 0.12 218)` | `oklch(77% 0.03 210)` | `oklch(68% 0.03 214)` | `oklch(57% 0.03 218)` | no |
| 5 dusk | `oklch(64% 0.14 268)` | `oklch(77% 0.10 266)` | `oklch(49% 0.14 268)` | `oklch(64% 0.03 266)` | `oklch(56% 0.03 268)` | `oklch(45% 0.03 268)` | yes |
| 6 night | `oklch(57% 0.15 266)` | `oklch(71% 0.11 264)` | `oklch(43% 0.14 266)` | `oklch(58% 0.03 264)` | `oklch(50% 0.03 266)` | `oklch(40% 0.03 266)` | yes |

`dark sky?` drives the label colors (light type over the night part of the gradient) and the ring color.

#### Crescent path

Horizontal offset for node `i` of `n` in day `d`:

```
t   = n < 2 ? 0.5 : i / (n - 1)
dir = d % 2 === 0 ? 1 : -1
x   = round(dir * (-20 + 72 * cos(π * (t - 0.5))))
```

A half-circle sweep: the trail starts near center, bulges to one side mid-day, and returns — so each day is a crescent, and the direction **mirrors on alternate days** (left-bulge, right-bulge, left-bulge). The hollow of the crescent is intentional negative space.

#### Coach affordance

Sitting in the crescent's hollow, `top:42%`, 126px wide, inset 16px from the side opposite the bulge (**left on even days, right on odd** — mirror the alignment of its contents too):

- 58×58 circle, `linear-gradient(165deg, oklch(62% 0.08 152) 0%, oklch(48% 0.08 152) 60%)`, `box-shadow: 0 6px 0 oklch(36% 0.07 152), 0 10px 16px oklch(25% 0.05 265 / 0.25)`, 30px solid-white leaf mark centered.
- Below it, a white speech bubble: `border-radius:14px`, `padding:10px 12px`, `box-shadow: 0 3px 0 oklch(88% 0.02 85), 0 6px 14px oklch(30% 0.03 265 / 0.12)`, a 12×12 white square rotated 45° as the tail at `top:-6px` 14px in from the aligned edge. Text 11.5px / 800 / `oklch(34% 0.03 152)` / `line-height:1.35`. Copy per day: "Not feeling it today? Talk to me." / "Want to shuffle tomorrow?" / "Planning ahead? Let's talk."
- Tapping it should open the coach conversation (the prototype only shows a confirmation toast).

### 2. Week tab

Two directions are built side by side behind a segmented switch at the top — **A · Goal roll-up** and **B · Activity board**. They share everything except how the roll-up and the plan are presented. Pick one before implementing; the switch itself is a review device, not a shipping feature.

Content area: cream background, `padding: 0 20px 124px`.

#### Shared chrome

- **Week nav** — a row with two 32×32 white circular buttons (`box-shadow: 0 2px 0 oklch(90% 0.015 95)`, chevrons at 17px / 900 in `oklch(45% 0.02 150)`) around a centered label: range "21–27 Jul" 13.5px / 900, and beneath it a tag "THIS WEEK" / "NEXT WEEK" / "LAST WEEK" 10px / 800 / `letter-spacing:0.1em` / `oklch(55% 0.02 120)`. Swiping left/right should do the same thing in production.
- **Variant switch** — `background: oklch(92% 0.02 90)`, `padding:4px`, `border-radius:12px`, two equal buttons; active is white with `oklch(30% 0.02 150)` text, inactive transparent with `oklch(55% 0.02 120)`. Labels 11.5px / 900 / `letter-spacing:0.04em`.
- **Weekly check-in card** — appears **only when viewing a future week**, since planning happens ahead of the week. Full-width button, `linear-gradient(160deg, oklch(94% 0.04 152) 0%, oklch(91% 0.05 150) 100%)`, `border-radius:18px`, `padding:14px 16px`, `box-shadow: 0 2px 0 oklch(85% 0.04 152)`. 38×38 coach mark (same gradient/edge as the Today coach, 20px leaf), title "Plan the week together" 13px / 900 / `oklch(32% 0.05 152)`, sub "10-min check-in · sets your targets" 11.5px / 700 / `oklch(45% 0.05 152)`, trailing `›`. Opens the coach conversation.
- **Retro-log row** — white, `border:1px solid oklch(91% 0.015 85)`, `border-radius:16px`, `padding:13px 14px`. 30px `oklch(93% 0.02 250)` circle holding a 16px mic glyph in `oklch(45% 0.08 250)`; title "Already did something? Just tell me" 12.5px / 800; sub "Speak or type it — I'll fill in the week" 11px / 700 / `oklch(56% 0.02 120)`.
  **This is a first-class path, not a fallback.** Users often complete an activity without stepping through the walkthrough. Speech-to-text or typed free text ("ran 6k this morning, felt easy") should be parsed by the coach into a completion against the right planned item — filling its dot, updating the roll-up, and marking the Today node as done. Ambiguity resolves by asking, not by guessing silently. The same entry point should exist from the Today tab.
- **Comparison card** — "This week vs last week" 12.5px / 900. One row per metric: a 74px label 11.5px / 700, then two stacked 7px bars (`border-radius:4px`, track `oklch(93% 0.01 120)`) — last week in `oklch(75% 0.03 120)`, this week in `oklch(56% 0.09 152)` — and a right-aligned signed delta 11.5px / 900, green `oklch(45% 0.09 152)` when up, `oklch(50% 0.12 40)` when down, neutral `oklch(60% 0.02 120)` at zero. Legend below with 9px swatches. Metrics in the prototype: Runs, AF evenings, Home-cooked, Reflections.
- **Off-plan link** — dashed cream link "+ Log something off-plan", same treatment as before.

#### The dot progression (both variants)

A roll-up line reads "1 of 3 runs" followed by one 13px dot per **planned** occurrence:

- **Complete** → filled with the goal's color, no border.
- **Partial** (short version or weather swap) → `linear-gradient(90deg, <color> 50%, oklch(94% 0.01 120) 50%)` with a `1.5px solid <color>` border — a half-filled dot. Partial counts as **0.5** toward pace.
- **Not yet** → `oklch(94% 0.01 120)` with a `1.5px solid oklch(87% 0.015 120)` border.

**Counts are derived from the plan, never hardcoded** — moving an activity between days re-derives every roll-up line immediately.

#### Pace chip

`round(planned × (todayIndex + 1) / 7) − credit ≥ 1` → "N BEHIND" (`oklch(93% 0.04 40)` / `oklch(45% 0.12 40)`); credit ≥ planned → "DONE" (`oklch(92% 0.05 152)` / `oklch(42% 0.09 152)`); otherwise "ON PACE" (`oklch(93% 0.03 152)` / `oklch(45% 0.08 152)`). 10px / 900 / `letter-spacing:0.04em`, `padding:3px 8px`, `border-radius:999px`.

When behind, the coach should **propose a specific reschedule** ("move the tempo run to Saturday?") rather than just reporting the gap — one tap to accept, which performs the same move as a drag.

#### Variant A — Goal roll-up

One white card per **goal** (`border-radius:18px`, `padding:15px 16px`, `box-shadow: 0 1px 3px oklch(0% 0 0 / 0.05)`, 12px between cards). Header: an 8px dot in the goal color, the goal name 13.5px / 900, and the pace chip. Below, one line per activity type that goal covers — summary text left, dots right.

Goals in the prototype: **Marathon in October** (`oklch(62% 0.12 214)`, runs), **Alcohol-free evenings** (`oklch(52% 0.09 152)`, reflections + mindset), **Eat for energy** (`oklch(70% 0.14 60)`, meals).

Then the plan as **7 stacked day rows** under a "THE PLAN · DRAG TO MOVE" label (11px / 900 / `letter-spacing:0.1em`). Each row: `border-radius:15px`, `padding:10px 12px`, 11px gaps; today's row is `oklch(97% 0.03 66)` with a `1.5px solid oklch(80% 0.10 62)` border, others white with a `1px solid oklch(92% 0.015 85)` border.
- 34px date column: weekday 10px / 900 / `letter-spacing:0.06em`, date 15px / 900 (past days dim to `oklch(62% 0.02 120)`).
- 22px forecast column: 16px weather glyph over the temperature at 9px / 800 / `oklch(58% 0.02 250)`.
- Focus line 12.5px / 800, with the day's activity pucks beneath.
- Right-aligned activity tally 11px / 900.

#### Variant B — Activity board

A single white card rolls up **by activity type**: header "N of M planned done" 13.5px / 900 with the pace chip, an 8px week-wide progress bar (`linear-gradient(90deg, oklch(60% 0.10 152), oklch(52% 0.09 152))` on `oklch(93% 0.01 120)`), then one row per type — 28px puck, summary "3 runs planned · 1 done" 12.5px / 800 with the owning goal beneath at 10.5px / 700, and the dots right-aligned.

Then the plan as a **horizontally scrolling 7-column board** under "DRAG TO RESHAPE THE WEEK". Each column is 78px wide, `min-height:172px`, `border-radius:16px`, same today/other treatment as A: date, forecast, a hairline, then the day's pucks stacked vertically at 30px.

#### Activity pucks

Small versions of the Today node — a circle with the type's face gradient and a `0 2px 0 <deep>` edge, holding a 15px solid-white glyph. 26px in A's rows, 30px in B's columns.

| Type | Face | Edge |
|---|---|---|
| Run | `linear-gradient(168deg, oklch(80% 0.10 208) 0%, oklch(70% 0.12 214) 52%)` | `oklch(56% 0.12 218)` |
| Meal | `linear-gradient(168deg, oklch(89% 0.12 78) 0%, oklch(79% 0.16 70) 52%)` | `oklch(63% 0.15 68)` |
| Mindset | `linear-gradient(168deg, oklch(87% 0.11 62) 0%, oklch(76% 0.15 55) 52%)` | `oklch(60% 0.14 52)` |
| Reflection | `linear-gradient(168deg, oklch(71% 0.11 264) 0%, oklch(57% 0.15 266) 52%)` | `oklch(43% 0.14 266)` |

**Drag to move.** A puck is draggable; a day row/column is a drop target. Dropping moves the activity to that day, re-derives the roll-up, and confirms with a toast. On touch this should be long-press-to-lift with the target day highlighting under the finger.

**At-risk badge.** An outdoor activity on a day forecast to rain carries a 14px `oklch(95% 0.02 250)` circle at its bottom-right with a 9px swap-arrows glyph in `oklch(45% 0.08 250)` — the same signal as the Today trail's "INDOOR SWAP" pill, and tapping through should offer the indoor alternative.

#### Forecast rules

Icons appear **only for days inside the forecast window**; beyond it the slot is left blank (no placeholder, no dash) rather than implying unknown weather. Glyphs: sun `oklch(62% 0.13 76)`, cloud `oklch(60% 0.02 250)`, rain `oklch(52% 0.09 250)`.

#### One shared calendar

Today's date is a single source of truth across both tabs — the prototype pins it to **Thu 24 Jul** (index 3 of a Mon–Sun week). The Today trail's day labels, the header date, the Week view's highlighted column, the forecast, and the pace math all derive from it. Never let the two tabs disagree.

### 3. Task start sheet (the pre-flight popup)

Opens on tapping any node. Backdrop `oklch(22% 0.03 262 / 0.42)`, sheet anchored bottom, background `oklch(97% 0.012 85)`, `border-radius: 26px 26px 0 0`, `padding: 20px 20px 26px`, `box-shadow: 0 -8px 30px oklch(20% 0.03 262 / 0.25)`, 38×4 grab handle (`oklch(87% 0.02 85)`) centered with 16px below.

- **Header row** — 13px gap. 58×52 ovaloid disc in the task's tone (same face gradient, `box-shadow: 0 5px 0 <deep>`, 24×11 sheen at `top:5px; left:9px`) with the 28px solid-white glyph. Beside it: title in **Fraunces 600, 19px**, `oklch(28% 0.02 150)`, `line-height:1.2`; meta line "07:00 · 3 STEPS · 5 MIN" 11.5px / 700 / `letter-spacing:0.04em` / `oklch(52% 0.02 120)`.
- **Step list** — `margin: 16px 0 18px`, 7px gaps. Each row: white, `border:1px solid oklch(91% 0.015 85)`, `border-radius:12px`, `padding:10px 12px`, 10px gap; a 6px dot in the task's `main` color, step title 13px / 700 / `oklch(32% 0.02 150)`, and the step's minutes right-aligned 11.5px / 700 / `oklch(58% 0.02 120)`.
- **Actions** — full-width stack, 10px gaps, `border-radius:16px`, 15px / 900, `padding:15px`:
  1. **Primary, green** — "Start · {total} min". `linear-gradient(180deg, oklch(60% 0.10 152) 0%, oklch(52% 0.09 152) 46%)`, `box-shadow: 0 5px 0 oklch(39% 0.08 152)`, white text.
  2. **Secondary, blue** — "I have less time · {short total} min". `linear-gradient(180deg, oklch(70% 0.08 250) 0%, oklch(62% 0.08 250) 46%)`, `box-shadow: 0 5px 0 oklch(47% 0.08 250)`, white text.
  3. **Tertiary, only when the task has a weather alternative and it's today** — "Indoor swap · {alt total} min" with the 17px rain glyph. `background: oklch(95% 0.02 250)`, `border:1.5px solid oklch(80% 0.05 250)`, text `oklch(38% 0.08 250)` at 14.5px / 900, `padding:14px`.
- Tapping the backdrop dismisses; tapping the sheet does not.

**Step-time rules.** Each step carries an explicit duration; the task total is the sum. Never distribute time evenly across steps if real per-step times exist — the numbers are shown to the user and must match the step copy.

**Short version rule.** Keep the setup step **plus the core (longest) step at half its duration** (min 2 min); if the task has ≤2 steps, keep them all. Never drop the core activity — the condensed run must still contain the run.

### 4. Task walkthrough (full-screen)

Covers the screen at the task tone's `tint`, `padding: 58px 20px 30px` (top clears status bar / Dynamic Island).

- **Control row** — 10px gap. 32×32 round close button, `oklch(100% 0 0 / 0.6)`, `✕` 16px. Then a 6px progress track, `oklch(100% 0 0 / 0.5)`, `border-radius:3px`, fill in the task's `deep` color, width = `round(step / total × 100)%`, `transition: width 0.3s`.
- **Step body** — centered column, 22px gaps. 112×100 ovaloid disc in the task's face gradient with `box-shadow: 0 8px 0 <deep>` and a 48×21 sheen, holding the 48px solid-white glyph. Then: eyebrow "STEP 2 OF 4" 11px / 800 / `letter-spacing:0.06em` / uppercase in `deep`; step title 21px / 800 / `oklch(25% 0.02 150)`; step body 14.5px / `line-height:1.5` / `oklch(40% 0.02 150)`.
- **CTA** — full-width, `border-radius:14px`, `padding:15px`, 15px / 900, white on the task's `deep` color. Label "Next", or "Finish" on the last step.
- **Celebration** — replaces the step body on finish: 110px disc in the task tone (`animation: pop 0.5s ease` — scale 0.4 → 1.08 → 1) with a white check at 52px; "Nice work!" 22px / 800; "{task title} complete" 14px; "+10 XP" 15px / 800 in `deep`. CTA becomes "Continue", which closes the overlay, marks the task done, and adds 10 XP.

### 5. Log sheet (off-plan logging)

Backdrop `oklch(20% 0.02 150 / 0.35)`, bottom sheet `oklch(96% 0.015 95)`, `border-radius: 22px 22px 0 0`, `padding: 20px 20px 28px`, grab handle, title "Log something you did" 15px / 800. Then a 2×2 grid, 10px gaps, of white buttons (`border:1px solid oklch(90% 0.02 85)`, `border-radius:14px`, `padding:14px`, left-aligned): 22px line glyph in `oklch(45% 0.07 152)` above a 13px / 700 label — Workout (running figure), Meal (apple), Mood (smile), Something else (pen). Picking one closes the sheet and shows a toast.

**Toast** — `top:70px`, inset 20px, background `oklch(30% 0.03 150)`, white 13px / 700, centered, `padding:10px`, `border-radius:12px`, auto-dismiss at 2.2s with a float-up animation (rises 40px while fading).

---

## Interactions & behavior

- **Tab switch** — Today ⇄ Week, instant.
- **Continuous day scroll** — one scroll surface across all days; no per-day paging, no scrollbar.
- **Header weather flip** — every **4.2s**, cross-fade between greeting and weather, each entering with `translateY(7px) → 0` + opacity 0 → 1 over 0.45s ease. In production, drive from the real forecast; only show the weather state when there's something worth saying (or when an outdoor task is affected).
- **Tap node** → start sheet. **Start / I have less time / Indoor swap** → walkthrough with the corresponding step list, and the task is immediately marked *started* (its disc turns vibrant even if the user backs out).
- **Next** → advance a step; on the last step → celebration. **Continue** → close, mark done (+10 XP).
- **Close (✕)** → abandon; task stays *started*, progress not retained (prototype behavior — decide whether production should resume mid-task).
- **Coach bubble** → open coach conversation.
- **＋ / detour / off-plan links** → log sheet.
- **Star/twinkle and pop** are the only ambient animations; nodes never pulse.

## State

| State | Type | Notes |
|---|---|---|
| `screen` | `'today' \| 'week'` | active tab |
| `done` | map of instance id → bool | completion, keyed per day-instance (`"0:t2"`), not per task definition |
| `started` | map of instance id → bool | drives vibrancy |
| `previewId` | instance id \| null | start sheet target |
| `selectedId` | instance id \| null | walkthrough target |
| `shortMode` | bool | condensed plan |
| `altMode` | bool | weather alternative plan |
| `stepIndex` | int | current step |
| `celebrating` | bool | completion screen |
| `xp`, `streak` | int | 40 / 12 in the prototype |
| `logSheetOpen` | bool | |
| `toast` | string \| null | 2.2s auto-clear |
| `showWeather` | bool | header flip |
| `weekVariant` | `'a' \| 'b'` | review-only switch; drop once a direction is chosen |
| `weekOffset` | int | 0 = this week; drives the range label and check-in card |
| `plan` | array of 7 days | each `{ label, date, focus, wx, temp, chips[] }`; chips are `{ k }` activity types |
| `dragFrom` | `{ dayIdx, chipIdx } \| null` | in-flight drag |

**Instance ids matter.** The same task definition appears on several days; identity is `dayIndex:taskId` so completing today's run doesn't complete tomorrow's.

Data the real implementation needs per task: id, title, scheduled time, category (mindset / movement / nutrition / reflection), ordered steps (title, body, minutes), and optionally a weather-alternative variant (title + its own steps). Days are an ordered list of task ids, **sorted chronologically** — the sky gradient and the tone ramp both assume it.

## Design tokens

**Surfaces** — app cream `oklch(96% 0.025 76)`; sheet cream `oklch(97% 0.012 85)`; card white `#fff`; night `oklch(23% 0.05 262)`; hairline `oklch(90% 0.015 95)`; card border `oklch(91% 0.015 85)`.

**Text** — primary `oklch(28–34% 0.02 150)`; secondary `oklch(45–52% 0.02 150)`; meta / mono-ish `oklch(52–58% 0.02 120)`; on-night primary `oklch(97% 0.01 265)`; on-night secondary `oklch(88% 0.03 268)`.

**Brand & action** — brand green `oklch(45–52% 0.07–0.09 152)` (nav active, coach, primary CTA); warm orange `oklch(78% 0.16 64)` with edge `oklch(62% 0.15 60)` (avatar, active tab); action blue `oklch(62% 0.08 250)` with edge `oklch(47% 0.08 250)` (secondary CTA, FAB `oklch(66% 0.14 258)`).

**Type** — Fraunces 600 for sheet/section titles (19px, and 32px on the intro heading); Nunito Sans 400/600/700/800/900 for everything else. Scale in use: 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 19, 21, 22px. Uppercase meta always carries `letter-spacing: 0.04–0.12em`.

**Radii** — 12 (chips, step rows), 14 (buttons, tabs, dashed links), 16 (badges, CTAs), 18 (cards), 22 / 26 (sheet tops), 999 / 50% (pills, discs).

**Elevation** — card `0 1px 3px oklch(0% 0 0 / 0.04)`; pressable disc `0 8px 0 <deep>, 0 13px 18px oklch(25% 0.05 265 / 0.20)`; small pressable `0 3–5px 0 <deep>`; sheet `0 -8px 30px oklch(20% 0.03 262 / 0.25)`.

**Spacing** — 4 / 5 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 26 / 30. Screen gutter 20px. Node row rhythm 30px. Bottom safe space 150px (Today) / 100px (Week).

**Motion** — `swapIn` 0.45s ease (7px rise + fade); `pop` 0.5s ease (0.4 → 1.08 → 1); `twinkle` 2.8–4.6s ease-in-out infinite (0.25 ↔ 0.9 opacity); `floatUp` 2.2s ease forwards (40px rise + fade); progress width 0.3s.

## Assets

No bitmaps. Every glyph is inline SVG on a 24×24 grid, authored here:

- **Solid white silhouettes** (on colored discs): sun, running figure, apple, moon, leaf (Cadence mark).
- **Line glyphs, 2–2.4 stroke** (on light surfaces): chat, flame, star, medal, smile, pen, rain cloud, swap arrows, calendar, magnifier, fork-and-knife, bar chart.

Replace these with the codebase's existing icon set where equivalents exist — keeping the **solid-on-color / line-on-light** split, which is deliberate. Fonts are Google Fonts (Fraunces, Nunito Sans); use whatever the app already bundles for these roles.

## Screenshots

`screens/` holds 2× captures of the live prototype, in the order a developer will build them:

| File | State |
| --- | --- |
| `01-today-morning.png` | Today, top of the trail — header, coach note, dawn nodes, coach bay |
| `02-today-night.png` | Today, scrolled into dusk/night — light type over dark sky, stars |
| `03-sunrise-between-days.png` | The sunrise band that separates one day from the next |
| `04-start-sheet.png` | Task start sheet with all three actions (green / blue / indoor swap) |
| `05-walkthrough-step.png` | Full-screen step walkthrough |
| `06-celebration.png` | Completion + XP |
| `07-log-sheet.png` | Off-plan log sheet |
| `08-week-a-rollup.png` | Week — variant A, goal roll-up cards |
| `09-week-a-plan.png` | Week — variant A, draggable day rows with forecast |
| `10-week-compare.png` | Week — this week vs last week |
| `11-week-b-board.png` | Week — variant B, activity board + scrolling columns |
| `12-week-checkin-next.png` | Week — next week, with the coach check-in card |

Screenshots are for orientation; **exact values come from this README and the HTML**, not from measuring the images.

## Files

- `Cadence Redesign.dc.html` — the design. Open in a browser; everything is inline-styled and readable.
- `support.js` — the prototype's template runtime. **Reference only, do not port.**
- `ios-frame.jsx` — desktop preview bezel. Not part of the design.

Inside the HTML, the data (tasks, steps, minutes, day composition) and the state logic live in the `<script data-dc-script>` block at the bottom; everything visual is in the markup above it.
