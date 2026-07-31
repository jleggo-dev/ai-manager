# Req 9 — The Mind toolkit: concept, tool inventory & build order

**Status:** concept ratified in an owner working session 2026-07-31 · builds REQ6's pillar on REQ8's
tool machinery · tools NOT yet built — this doc is the build plan. Companions: `REQ8-task-walkthrough-and-tools.md`
(the tool catalog / walkthrough rail these plug into), `REQ6-mind-pillar.md` + `REQ7-cross-pillar-and-experiments.md`
(pillar design + the coach-as-scientist substrate; on feature branches, not yet on main), `BRAND.md` (voice + crisis
boundary).

---

## 1. The frame (owner-ratified — supersedes both prior framings)

Two design passes missed the register from opposite sides: Claude Design's "mental fitness — a gym
for attention" (reps/load/performance; erased self-worth entirely), then an over-corrected
"hearth-only" counter-brief that implied the coach never assigns anything. The owner's synthesis:

- **The coaching structure transfers; the borrowed vocabulary changes.** On the body side the
  user is an *athlete in training* and the coach assigns drills. On the mind side the user is a
  **practitioner in training** — "a guru or bodhisattva in training, without the religious context
  (unless the user brings one)." The coach still assigns practice; "training," "practice," even
  "drill" are honest words. But the vocabulary comes from the contemplative tradition (sit,
  practice, session, breath, noticing, returning, settling) — **not** gym metrics (reps, load,
  PRs, performance) and **not** the clinic (symptoms, treatment, protocols, "mental health").
- **Everyday anxiety is coachable.** All humans have it, naturally; the coach coaches through it in
  plain words — breath, grounding, reframing, worry-parking are coaching moves, not treatment. The
  **crisis boundary** (BRAND) is unchanged and gates only acute distress: deterministic vetted
  copy, name resources, defer. "Never say CBT" stands.
- **Secular by default; the user's own tradition is welcome.** If someone's practice *is*
  religious (prayer, dhikr, a rosary), the coach supports it in their terms — that's what the
  `practice` area is for. The coach never supplies doctrine; it supplies rhythm.
- **Self-worth and self-love are first-class goals** — the practices that train them (e.g.
  loving-kindness, secularized as "kind wishes"; evidence-of-worth journaling) must exist in the
  toolkit. A frame that can't hold "I want to be kinder to myself" is the wrong frame.

## 2. What the market has (verified 2026-07)

Four archetypes, and a gap:

| Archetype | Examples | Tools baked in? |
|---|---|---|
| Content-first libraries | Calm, Headspace, Insight Timer, Waking Up | Some: Calm Check-Ins (mood, **gratitude journaling**, sleep log) + breathe bubble; Headspace SOS + breathing; Insight Timer's classic bell timer. Tools are side-features that feed content recommendations. |
| Single-tool specialists | Breathwrk (breath pacer as an entire company), Day One (journal), How We Feel (emotion check-in), Five Minute Journal / Gratitude / Presently (gratitude logs & letters), Rootd/DARE (panic toolkits) | Yes — each proves ONE of our widgets has a standalone market. None compose; none remember you across tools. |
| Chat "coaches" | Woebot (**consumer app shut down June 2025**, pivoted enterprise), Wysa, Youper | Conversation is the tool; scripted trees; no composable widgets, no real plan. |
| Gamified habit shells | Finch, Fabulous | Micro-practices (breathing, gratitude prompts, journaling) composed into a day — but by a pet/routine template, not an intelligent coach. Closest structural cousin. |

**AI status:** Headspace's Ebb (voice + memory, expanding 2026) *recommends content and triages*;
Calm's AI *recommends from the library*. **Nobody composes configurable practice tools into a
personalized, remembered rhythm — and nobody crosses pillars** (the REQ7 moat). This validates
REQ6's build order: tools first, content library last. Every one of our widgets has a
proven-standalone competitor; the composition is ours alone.

## 3. Complexity taxonomy — "timer-like or food-module-like?"

Three classes. Most mind tools are **timer-class**; exactly two things are module-class.

- **Class 1 — widget** (like `StepTimer`): pure client renderer + a catalog entry + normalize
  whitelist. `breath`, `sit`, `ground`, `checkin`.
- **Class 2 — widget + service**: a widget with one AI-Admin job or platform service behind it.
  Voice journaling (STT job), TTS-guided audio (frozen script → TTS job + player), gratitude
  share-out (compose + OS share sheet).
- **Class 3 — module** (like Food): own store, own history surface, multiple entry points. Only
  the **Journal** (entries outlive occurrences; history, privacy, Scribe parse) and the **content
  library** (REQ6 §6 — horizontal with Fitness, built last).

**The REQ8 rail fits.** Catalog → `SessionItem.tool` → renderer → `StepLog` → recap works for mind
unchanged; sets/reps simply go unused (tools ignore fields they don't read). What the rail is
*missing* for mind:

1. **The "now door"** — an unscheduled entry point ("I need a minute") for breath/ground/sit.
   Mind practices are half reactive; the trail only shows what was planned. Unscheduled use logs
   to the day but draws no node (the trail stays a picture of what you and the coach agreed).
2. **A journal store** — occurrence-log notes aren't a journal; entries need their own table +
   history view.
3. **Audio/background behavior** — long sits and sleep audio need screen-dim, keep-awake, and
   background playback; the workout walkthrough never needed these.
4. **The crisis rail as shell furniture.** BRAND's crisis boundary gates *acute* distress only —
   but the surface it lives on must exist from the first calm tool, not the last. People reach a
   breath pacer or a grounding game *while dysregulated*, and those ship first. One line of
   furniture, same position and copy on every mind surface, reads as an exit and never as an
   alarm. (Design's assessment caught this; it was originally scoped to the stepped-protocol
   phase, which was wrong.)
5. Already there: quick-shape (single-tool, one-tap) tasks, the grey pre-roll, partial-elapsed
   logging ("4 of 10 min · that counts" — partial is the normal case, never shamed).

**Three chromes, not eleven tools.** The inventory below is eleven payloads across **three**
surfaces, and briefing the surface before its payloads is what keeps the pillar coherent:
**A · the calm surface** (full-screen, dark-primary, one moving form — breath, silent timer,
guided sit, sleep wind-down); **B · the stepped micro-flow** (tap-forward cards on a deterministic
spine — grounding games, chained practices, the stepped program); **C · capture** (the existing
sheet vocabulary — check-in, journal, gratitude). The content library is a fourth thing: a
Food-depth module, cross-pillar, last. **`breath` is not a countdown** — a ring reads as *time
remaining*, but a breath pattern is a phase loop, so the calm surface shares StepTimer's chrome
(card, pre-roll, chime, log-on-complete) and replaces its ring.

## 4. The tool inventory

Each tool = one `COACH_TOOLS` catalog entry (compile-locked to a renderer, injected into the coach
prompt via `{{tool_catalog}}` — the REQ8 pattern). Params ride typed optional `SessionItem` fields;
`session-normalize` clamps everything to safety caps (as it caps circuit rounds today).

### 4.1 `breath` — the pacer (Class 1)

One deterministic model covers every technique: **a pattern = ordered phases**
`[{label, seconds, cue?}] × cycles`. The player animates any pattern (expanding form + traveling
light; the device owns the timing — "nothing to count").

**Coach params:** `pattern` (preset name or custom phases), `cycles` *or* `minutes`, plus the
framing line. User overrides at play time; "find my rhythm — tap four turns" lets a person seed
their own counts (kept from the design pass — it was good).

**Preset bank (v1):**

| Preset | Phases | For |
|---|---|---|
| Box | 4-4-4-4 | steadying, focus |
| 4-7-8 | in 4 · hold 7 · out 8 | wind-down, sleep |
| Coherent | in 5.5 · out 5.5 | the daily baseline practice (HRV; best-evidenced) |
| Extended exhale | in 4 · out 6→8 | fastest teachable down-shift |
| Physiological sigh | in · top-up in · long out | acute calm, 3–5 cycles |
| Triangle | 4-4-4 | box minus a hold |
| Equal | n-n | beginner pacing |
| Alternate nostril | side cues per phase | settling; cue text tells the hand what to do |
| Up-shift | in-biased quick cadence, ≤30s | pre-effort energize — **gated** |

**Safety caps (normalize-enforced, coach cannot exceed):** hold ≤10s v1; session ≤10 min;
up-shift ≤30s + seated copy ("sit down; stop if dizzy"); **no hyperventilation + breath-hold
patterns (Wim Hof-style) in v1** — deliberately not in the catalog.

### 4.2 `sit` — meditation / mindfulness timer (Class 1, extends StepTimer)

A held quiet. **Params:** `minutes`, `bells` (start / interval / end), optional ambience. Reuses
the timer's grey pre-roll ("get in position" → "settle in"), chime, and partial-elapsed logging.
One addition: an optional **"came back" tap** — counts returns without judging them (noticing the
drift *is* the practice; there is nothing to fail). Silent by default; guided sits are `listen`.

### 4.3 `ground` — grounding / distraction family (Class 1)

Reactive tools for a racing moment. One tap-forward stepped shell, big targets, no scores, no
timer pressure; leaving early still counts. **Params:** `game`:

- `senses` — 5-4-3-2-1 (see 5, hear 4, feel 3, smell 2, taste 1)
- `letters` — A→B→C naming; bank: animals / foods / cities
- `switch` — category-switch prompts
- `countback` — count back from 100 by 7s
- `object` — 60 seconds on one object
- `cold` — instruction card (cool water on the face; safe, no interaction)

Close = "did that help?" (yes / no / skip) → logs to the arc as self-report. Primary home is the
**now door**, zero setup; the coach may also schedule one or offer one in chat.

### 4.4 `checkin` — the mind-side instrument (Class 1)

The pillar's weigh-in (the arc's Observe instrument, REQ6 §4): pick the word that fits (granular
emotion vocabulary — naming precisely is itself the practice), intensity, optional one-line
trigger note. ~20 seconds. Feeds baselines ("your triggers cluster around work handoffs") and
REQ7's cross-pillar correlations. How We Feel proves the shape standalone.

### 4.5 `journal` — deepened (Class 2/3 — the widget is small; the **store** is the module)

- **Modes:** typed; **spoken** — record → STT (commodity job) → show transcript → edit → save.
  Audio discarded after transcription in v1 (cost + privacy; revisit if demand).
- **Prompted or free:** prompt chips from **deterministic banks**, coach-personalized in order
  (`suggest_gratitude_prompts`-class job); blank page always allowed.
- **Banks (v1):** gratitude (three good things), savor (photo + a line — uses `photo`),
  a win, smallest next thing, "what's actually true," worry-park, evening review (chained).
- **The store (new):** `journal_entries` table — id, user, ts, source occurrence?, bank, text,
  visibility. History = reverse-chron list (module-lite), entries resurface in `recap` ("three
  weeks ago you wrote…" — the memory moat).
- **Privacy:** the coach reads entries by default and says so plainly at first use ("I keep your
  notes so I can know you better — mark anything private and I won't use it"). Per-entry
  **private toggle** excludes from context packs. Export + delete. Scribe `parse_mind_log`
  extracts themes/valence to case notes; never judges.

### 4.6 Gratitude — banks + **share-out** (Class 2; resolves REQ6's deferral)

Three tiers:
1. **Log** (v1): the gratitude banks above + streak/consistency/recap surfacing.
2. **Compose-and-share via the user's own channels** (v1.5): write a gratitude note to a real
   person → **OS share sheet** → *they* send it from their own iMessage/email/WhatsApp. **We
   never send anything** — which dissolves REQ6's whole deferral rationale (consent,
   deliverability, abuse were all properties of *platform-sent* outbound). The classic
   "gratitude letter" practice; research says writing it delivers most of the benefit even
   unsent, so the close is "send it, read it to them, or keep it."
3. **Platform-sent messages: deferred indefinitely.** No third-party comms infrastructure.

### 4.7 `listen` — guided audio player (Class 2 now; Class 3 later)

**v1 = TTS-guided practice** (REQ6's unlock: vetted, frozen scripts → TTS job — no licensing, no
hallucinated URLs, personalizable length): body scan, wind-down, and **loving-kindness /
"kind wishes"** — the self-worth & self-love practice, and the most literal
"bodhisattva-in-training" drill we ship. Player: play/pause, remaining, short/long variant, and a
**sleep mode** (fade + stop-after-N, screen-dark). **Later:** the same player fronts the retrieved
content library (podcast RSS etc., REQ6 §6) — never renders anything a retriever didn't return.

### 4.8 Chained practices — not a new tool

The evening review, thought-reframe (what happened → what I told myself → what's actually true),
and worry-park-then-revisit are **ordered chains of `journal` + `ground` + `read` steps on a
deterministic tree with coach turns between** — the walkthrough shell already plays ordered
steps. REQ6 §5.2's one-deep stepped program is this pattern grown up: no new engine, new *trees*.

## 5. Coach configuration — one pattern for everything

Adding a mind tool = the REQ8 recipe, unchanged: a `COACH_TOOLS` entry (summary / trap / fields /
example — the prompt teaches itself via `{{tool_catalog}}`), a client renderer, normalize
whitelist + caps, tests. The coach picks tools by catalog line and fills params on the
`SessionItem`; deterministic banks (breath presets, prompt banks, grounding games, TTS scripts)
live in `@cadence/shared` so the safety-relevant content is code-reviewed, never generated live.
The register rules (§1) go in the coach prompts the same sync-gated way as everything else.

## 6. Build order (one at a time; each independently shippable)

1. **`breath`** — the signature widget; pure client; ships the pillar. Lands **with the now door**
   (it must be reachable unscheduled to be itself), **the calm surface (chrome A)**, and **the
   crisis rail** — the three pieces of spine everything later inherits.
2. **`sit`** — extends StepTimer (bells, settle pre-roll, "came back" tap, keep-awake).
3. **`checkin`** — small; starts the Observe data flowing (REQ6 §10: instrument demand first).
4. **`ground`** — the family shell + senses/letters/switch first.
5. **Journal store + written journal** — the module foundation + gratitude banks.
6. **Voice journaling** — STT job on top.
7. **Gratitude share-out** — compose + share sheet.
8. **`listen` v1** — TTS player: body scan, wind-down, loving-kindness.
9. **Chained practices** — evening review → reframe → worry-park (then REQ6's one deep program).
10. **Content library** — horizontal with Fitness, last (REQ6 §6 unchanged).

## 7. Open questions

- **Where does the now door live?** A quiet affordance on Today vs. inside the ＋ FAB vs. both.
- **`SessionItem` params:** typed optional fields per tool (REQ8 idiom) vs. one `params` jsonb —
  decide at `breath` build time; leaning typed fields + normalize caps.
- **Check-in vocabulary:** which emotion-word set (needs to be granular but not clinical).
- **Journal retention/export format** and whether private entries are still Scribe-parsed for
  *aggregate* signal (leaning no — private means private).
- **TTS voice** — the coach's voice or a distinct practice voice? Plus **time-to-first-audio** and
  streamed-vs-pre-rendered, which decides whether the guided player needs a loading state at all.
- **Where "did it help?" lands in the data model**, and whether `recap` consumes mind self-reports
  the way it consumes body counts — that determines whether Mind can appear in the weekly
  check-in at all. Design position taken: a single three-way tap, dismissible by leaving, asked at
  most **once a day across all mind surfaces** (it's the pillar's only signal — nothing here has
  reps or grams — so asking it four times a day would read as nagging, not care).
- **Do mind practices log as occurrences** with the existing status vocabulary (`skipped` vs
  `missed`, freezes, detours), or something new? Leaning existing.
- **The crisis rail's shipping copy deck + resource list** — needed before the rail is built, not
  designed around a placeholder.
- **Library routing** — its own tab, under Mind, or a shared cross-pillar surface? A pricing and
  moderation decision, not a layout one.
