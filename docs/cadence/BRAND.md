# Cadence — Brand Identity (v1.0, 2026-07-04)

Canonical brand reference. Every user-facing word, prompt persona, and schema name decision
defers to this document. Process: 4 independent identity proposals (rhythm / conversation-first /
companion-memory / anti-hustle) scored by a 3-lens judge panel (brand fit, breadth, code
practicality), synthesized; full rationale in the workflow run of 2026-07-04.

**Amendment 2026-07-24 (streaks return, protected).** The v1.0 "streaks retired" stance is
reversed by founder direction ("our brand is about building better habits"). Streaks return as a
**protected momentum counter** — a freeze economy + check-ins + detours mean the count never
resets to zero *because life happened*, and the honest `5 of 7` rolling metric always coexists.
The affected lines below are updated; full design + rationale in `PLAN.md` "Req 4".

---

## The identity

**Tagline:** `a rhythm you can keep`

Runner-ups (approved alternates for campaigns/secondary surfaces):
- *keeps time with your life*
- *rhythm, not resolutions*
- *the coach that remembers*

**One-liner:** A coach you just talk to — it listens, remembers you, and turns what you say into
a rhythm you can keep.

**App-store line:** Cadence — the coach that remembers you. Just talk: it builds your plan and
bends it when life happens.

**Elevator pitch:** Cadence is a coach you simply talk to — about the first 10k, eating better, a
steadier mind, the daily pages. No forms, no setup: as you talk, it quietly turns your words into
a real plan, with a pace you set, built around what you have and what you're working around. It
remembers you — your goals, your knee, what happened last week — so every conversation picks up
exactly where your life left off. And when life happens — travel, injury, grief, a brutal week —
the plan bends instead of breaking.

**Brand promise (testable — the product must always deliver this or the brand is a lie):**
> Cadence never makes you repeat yourself and never makes you start over: it remembers what
> you've told it, and when life changes, the plan bends instead of resetting to zero.

## Positioning

- We present as a **coach**, never a "fitness app". The category word is *coach*; the unit is the
  *rhythm*. Both hold for a marathon, sobriety, prayer, or a novel without a rebrand.
- **Fitness-first at launch via example order, not taxonomy.** The first examples on every
  surface are a run and a meal; the third example rotates (a steadier mind, daily pages) to keep
  the door visibly open. The taxonomy ships day one with a first-class home for every kind of
  goal, so broadening is an enum addition — never a migration, never a brand refresh.
- **Hearth, not scoreboard.** The coach mark is a sunrise — a terracotta arch over a forest-green
  horizon line (2026-07-11, "Trust & Wellness" palette; superseded the ember orb on dark violet).
  Copy must never turn it into a scoreboard: a streak is a warm momentum counter (protected by
  freezes and detours), never a cudgel — no streak-shame, no red marks, and it never resets to
  zero because life happened.

## Voice principles

1. **Remember out loud, gently.** "Last week you mentioned your knee" — never make someone repeat
   what they already told you, and never recite their whole file back.
2. **Plain, kind words for hard things.** Say "burnout", "grief", "relapse" simply and without
   flinching — no fitness metaphors, no clinical euphemism, no brand-speak standing in for a hard
   fact.
3. **Count what happened, never what broke.** "You showed up 5 of 7 days this week" — the honest
   rolling metric is always there. A **streak** may sit beside it as a momentum counter, but
   freezes, check-ins, and detours keep it from ever resetting to zero because life happened; a
   missed day is information, not failure — never a red mark.
4. **Use their words, not ours.** "Your 5k", "your pages", "your Tuesday runs" — never "your
   fitness journey", never system labels, never a category name the user didn't say first.
5. **Confirm before you commit.** "Here's what I heard — did I get it right?" Cadence asks; it
   never assumes and never silently records.
6. **Warm, level, unhyped.** A steady friend at 6am — short sentences, no exclamation marks, no
   confetti cannon, no drill sergeant. The coach speaks as **"I"** on every surface (never "it",
   never "the coach" in its own mouth).

## Approved core copy

- **Welcome:** "Just talk — about getting stronger, eating better, a steadier mind, a practice
  you're building. Cadence listens, remembers what matters, and shapes it into a rhythm you can
  keep. When life happens, the plan bends instead of breaking."
- **Steps:** Talk to your coach · Confirm what it heard · Set your rhythm
- **Stepper:** Talk · Confirm · Set

## Nomenclature

**The governing rule: warm brand words in the UI; boring, stable words in the schema and LLM job
prompts.** A brand refresh must never touch a column name. UI labels and canonical names are
allowed to differ — that's the pattern working, not an inconsistency.

| Concept | Canonical (code/DB/prompts) | User-facing label | Notes |
|---|---|---|---|
| Equipment | `equipment` (NEVER `tools` in schema/prompts) | **Tools — what you're working with** | "tools" collides with LLM tool-calling vocabulary; UI-only |
| Injuries | `constraints` `{ label, kind?: physical\|life\|other, plan_around }` | **What we work around** | burnout, grief, night shifts fit; `plan_around` is the kernel to keep |
| Goal categories | `area: movement \| nourishment \| mind \| practice` (extensible: craft, spirit, learning) | Areas — but copy names the goal ("your 5k"), not the area | `weight` deleted as category — a weight target is `measure.target` on a goal |
| Goal types | `milestone \| target \| recurring` (unchanged) | Milestone (a day you're aiming at) / Target (a number you're moving toward) / Ongoing (something you keep doing) | mechanism words; never rename for brand |
| Lock the plan | `plan.status: draft → committed` (+ `committed_at`) | **Set your rhythm** | "lock" is a cell door; contradicts bend-don't-break |
| Review captured items | `notes` table concept; review step | **Confirm what it heard** | "captured" is surveillance language — banned user-facing |
| Adherence | `consistency` | **Consistency — how you showed up this week** | "adherence" is pharmacy compliance language |
| Disruptions | `detours` (cause + duration) | **Life happened? Let's take a detour** | cause is always named plainly (say "grief", never euphemize) |
| Weekly readout | `recap` | **Your weekly check-in** | two-way: report, then ask how the week went |
| Context pack | `memory_pack` | **What Cadence remembers about you** | the moat, surfaced as the trust screen |
| Broker (capture AI) | `Broker` — the Scribe rename is **reverted** (owner ruling 2026-08-04) | never surfaced; UI describes the behaviour ("Cadence takes notes while you talk") without ever naming the entity | a hidden entity needs no display name. "Internal name that leaks safely" solved a problem that doesn't exist: to the user there is only the coach, and the Broker is the technical way we deliver that. Do not reintroduce "Scribe" |
| Streaks | **returned as a protected counter** atop the rolling window `kept_count / window`; state in `users.streak_state` (current/longest/freezes) | "5 of 7 this week" **+** a streak count; a **freeze** absorbs an ordinary slip, a **detour**/check-in shields a rough patch — never "streak lost" for living | freezes + `paused` (episode) days + `skipped` vs `missed` keep it from punishing life; design in PLAN.md "Req 4" |
| Coach | `coach` (unchanged) | your coach | the category word; does double duty |
| Baseline | `baseline` (unchanged) | Baseline | reads as "bassline" — free brand story |
| Occurrences | `occurrences` (unchanged — never `beats`) | Today / Your week | plain activity names in product |

**Banned words/moves** (judge-vetoed — do not reintroduce):
- `beats`, `instruments`, `tempo changes` in schema, prompts, or product UI (metaphor tax; opaque; degrades LLM extraction)
- `tools` as a schema/prompt field name (LLM tool-calling collision)
- `resources`, `limits` for constraints (HR-speak; judgmental + code collision)
- `Listener` as a service name (event-listener ambiguity)
- `plan.status = 'set'` (unsearchable stopword)
- "captured" in any user-facing copy (surveillance framing)
- "someone in your corner", "gentle is a strategy", "unlock/empower/journey/transform" (wellness clichés)
- streak mechanics that **punish you for life happening** — reset-to-zero on travel/illness/a rough week, streak-shame, red marks. A *protected* streak (freezes + detours + check-ins, always beside the honest 5-of-7) is the sanctioned form; see PLAN.md "Req 4"

## Safety note (brand-critical)

Broadening constraints to include grief/burnout/anxiety makes a **mental-health crisis boundary**
in the coach persona mandatory (recognize crisis signals, name resources, defer — never coach
through acute crisis). This is part of the brand promise, not just compliance.
