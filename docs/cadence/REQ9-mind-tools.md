# Req 9 — The Mind toolkit: concept, tool inventory & build order

**Status:** concept ratified in an owner working session 2026-07-31 · builds REQ6's pillar on REQ8's
tool machinery · tools NOT yet built — this doc is the build plan. Companions: `REQ8-task-walkthrough-and-tools.md`
(the tool catalog / walkthrough rail these plug into), `REQ6-mind-pillar.md` + `REQ7-cross-pillar-and-experiments.md`
(pillar design + the coach-as-scientist substrate; on feature branches, not yet on main), `BRAND.md` (voice + crisis
boundary).

---

## 0. Plain-English glossary

Terms used throughout, defined once so nobody has to reverse-engineer them.

| Term | What it means |
|---|---|
| **The tools** | `breathing` (breathing-exercise player), `meditate` (silent timer with optional bells), `grounding` (distraction games — name animals A/B/C, 5-4-3-2-1 senses, count back by 7s), `feeling_log` (the 20-second "how are you doing" instrument — pick a word, say how much room it's taking, optionally add a line), `journal` (write or speak an entry), `guided_audio` (narrated audio player). Code names only — **users never see these words.** |
| **The extras menu** | The ＋ button's sheet gains a second section, *"Do something now"*, listing 3–5 things the coach picked for this person (a grounding game, 20 extra pushups, 10 Hail Marys). Present tense, above the existing past-tense *"Log something you did."* |
| **"Something else?"** | A quiet link shown during a practice that isn't landing. Opens the same extras menu. Not a safety feature. |
| **The pill** | A small labelled button (words, not a bare icon) used when the coach pins one shortcut to the top of the extras menu. |
| **The three surfaces** | Every mind tool renders on one of three screen types: **the calm surface** (full-screen, dark, one moving form — breathing, timers, audio); **the stepped flow** (tap-forward cards — grounding games); **capture** (the existing sheet style — mood note, journal). |
| **Check-in** | Reserved for the *coaching conversation* — weekly, or on return after an absence. Calibration: how are you feeling, how is progress, what changed. **Not** the `feeling_log` tool. |
| **Partial credit** | Stopping early still counts: "4 of 10 min · that counts." Never a percentage, never "incomplete." |

*Withdrawn terms:* the "escalation ladder" / "rungs" (§3.4, §8) and the "now door" as a separate
control (§3.1) — both superseded; noted here only so older commits and design files read clearly.

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
  plain words — breath, grounding, reframing, worry-parking are coaching moves, not treatment.
  Acute distress is where the coach steps back and says so, **in conversation** — that boundary
  lives in the system prompt, not in any screen (§8). "Never say CBT" stands.
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
  whitelist. `breathing`, `meditate`, `grounding`, `feeling_log`.
- **Class 2 — widget + service**: a widget with one AI-Admin job or platform service behind it.
  Voice journaling (STT job), TTS-guided audio (frozen script → TTS job + player), gratitude
  share-out (compose + OS share sheet).
- **Class 3 — module** (like Food): own store, own history surface, multiple entry points. Only
  the **Journal** (entries outlive occurrences; history, privacy, Scribe parse) and the **content
  library** (REQ6 §6 — horizontal with Fitness, built last).

**The REQ8 rail fits.** Catalog → `SessionItem.tool` → renderer → `StepLog` → recap works for mind
unchanged; sets/reps simply go unused (tools ignore fields they don't read). What the rail is
*missing* for mind:

1. **The "now door" — shell-level and plan-relative, NOT Mind-owned** (owner correction
   2026-07-31; supersedes the Mind 1 design's global breath-disc). The universal need is "I have
   something right now" — extra capacity, a pull toward practice, a rough moment. Its *content*
   is personal: the calm-program user gets grounding options, the athlete gets a stretch or 20
   extra pushups, the practice user gets 10 Hail Marys. So the door is a **neutral shell
   affordance opening a coach-composed, cached menu** (REQ10 §6), with an optional coach-pinned
   one-tap express lane per user. **Resolved by Design 2026-08-01 — ONE control, not two:** the
   door is the **existing ＋ FAB**, whose sheet gains a second section — *"Do something now"*
   (present tense) above *"Log something you did"* (past tense). A neutral second disc proved
   indistinguishable from the ＋; the two-tense sheet keeps one affordance. A coach-pinned
   express item renders as a **labelled white pill**, never a disc. Empty state = the section is
   simply absent (no door until the coach has composed a menu). **The shell law:** nothing pillar-flavored ever ships in the
   frame — the shell offers doors, the coach decides what's behind them. Mind supplies
   *payloads* behind the door, never the door itself. Unscheduled use logs to the day but draws
   no node. Brief: `design/now-door-brief.md`.
2. **A journal store** — occurrence-log notes aren't a journal; entries need their own table +
   history view.
3. **Audio/background behavior** — long sits and sleep audio need screen-dim, keep-awake, and
   background playback; the workout walkthrough never needed these.
4. **"Something else?" — a tool switch, and nothing more** (owner correction 2026-08-01, which
   **dissolved the "escalation ladder"** designed the day before; that three-rung structure is
   withdrawn — see §8 for why). A practice that isn't landing offers one quiet link to *the same
   extras menu the ＋ sheet shows* — a different breathing pattern, a grounding game, a walk. It
   is **not a safety feature and carries no emergency content**. Talking to the coach needs no
   special path: the Coach tab already exists. The app ships **no emergency chrome at all** (§8).
5. Already there: quick-shape (single-tool, one-tap) tasks, the grey pre-roll, partial-elapsed
   logging ("4 of 10 min · that counts" — partial is the normal case, never shamed).

**Three chromes, not eleven tools.** The inventory below is eleven payloads across **three**
surfaces, and briefing the surface before its payloads is what keeps the pillar coherent:
**A · the calm surface** (full-screen, dark-primary, one moving form — breath, silent timer,
guided sit, sleep wind-down); **B · the stepped micro-flow** (tap-forward cards on a deterministic
spine — grounding games, chained practices, the stepped program); **C · capture** (the existing
sheet vocabulary — check-in, journal, gratitude). The content library is a fourth thing: a
Food-depth module, cross-pillar, last. **`breathing` is not a countdown** — a ring reads as *time
remaining*, but a breath pattern is a phase loop, so the calm surface shares StepTimer's chrome
(card, pre-roll, chime, log-on-complete) and replaces its ring.

## 4. The tool inventory

Each tool = one `COACH_TOOLS` catalog entry (compile-locked to a renderer, injected into the coach
prompt via `{{tool_catalog}}` — the REQ8 pattern). Params ride typed optional `SessionItem` fields;
`session-normalize` clamps everything to safety caps (as it caps circuit rounds today).

### 4.1 `breathing` — the pacer (Class 1)

One deterministic model covers every technique: **a pattern = ordered phases**
`[{label, seconds, cue?}] × cycles`. The player animates any pattern (expanding form + traveling
light; the device owns the timing — "nothing to count").

**Coach params:** `pattern` (preset name or custom phases), `cycles` *or* `minutes`, plus the
framing line.

**No picker — the coach prescribes, the person does it** (owner ruling 2026-08-02). A prescribed
step plays exactly the pattern and count the coach chose; there is no rhythm list, no rounds dial,
and no setup screen in the player. This supersedes the earlier "user overrides at play time" line
here and the rhythm/rounds setup screen in Design's Mind 1 §2e — both are withdrawn. The reasoning
is the pillar's own frame: a coach that hands you a menu isn't coaching, and nine options in front
of someone who wants to settle is a decision they didn't ask for. Unscheduled use is still
coach-chosen — the extras menu carries params on each item (`breathing(box, 6)`), so the choice was
made when the menu was composed. The nine-pattern picker exists **only** in the dev harness
(`features/dev/BreathingPreview.tsx`, `?preview=breathing`), which nothing links to.

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

### 4.2 `meditate` — meditation / mindfulness timer (Class 1, extends StepTimer)

A held quiet. **Params:** `minutes`, `bells` (start / interval / end), optional ambience. Reuses
the timer's grey pre-roll ("get in position" → "settle in"), chime, and partial-elapsed logging.
One addition: an optional **"came back" tap** — counts returns without judging them (noticing the
drift *is* the practice; there is nothing to fail). Silent by default; guided sits are `guided_audio`.

### 4.3 `grounding` — grounding / distraction family (Class 1)

Reactive tools for a racing moment. One tap-forward stepped shell, big targets, no scores, no
timer pressure; leaving early still counts. **Params:** `game`:

- `senses` — 5-4-3-2-1 (see 5, hear 4, feel 3, smell 2, taste 1)
- `letters` — A→B→C naming; bank: animals / foods / cities
- `switch` — category-switch prompts
- `countback` — count back from 100 by 7s. **No input, no aids, no validation** (owner +
  Design, 2026-08-02): the mental arithmetic IS the mechanism — it occupies the part of the mind
  that is spiralling — so handing over a keypad or a running total would remove the very thing
  that works, and marking an answer wrong would inject failure-anxiety into a tool whose whole job
  is relieving it. You tap forward and the app believes you. Same for `switch`.
- `object` — 60 seconds on one object
- `cold` — instruction card (cool water on the face; safe, no interaction)

Close = "did that help?" (yes / no / skip) → logs to the arc as self-report. Primary home is the
**now door**, zero setup; the coach may also schedule one or offer one in chat. The family is
also **rung 1 of the escalation ladder** (§3.4): mid-practice "Something else?" offers exactly
these as the in-the-moment alternates — they are the everyday answer that keeps ordinary rough
moments out of "crisis" territory.

### 4.4 `feeling_log` — the mind-side instrument (Class 1)

The pillar's weigh-in (the arc's Observe instrument, REQ6 §4): pick the word that fits (granular
emotion vocabulary — naming precisely is itself the practice), intensity, optional one-line
trigger note. ~20 seconds. Feeds baselines ("your triggers cluster around work handoffs") and
REQ7's cross-pillar correlations. How We Feel proves the shape standalone.

**Provenance:** proposed in this doc, not an owner requirement — derived from the arc's need for an
Observe phase. Owner-confirmed 2026-08-02, with the rulings below.

**Owner rulings (2026-08-02), answering Design's Mind 2 §E:**

- **Where it lives.** Primarily the **＋ extras menu**, placed there by the coach for someone
  dealing with stress or anxiety. It **can also be a daily task** — the coach decides.
- **Scheduling is phase-bound, not permanent.** During Observe (roughly week 1 of a mind goal) the
  coach needs data, so it may schedule it daily; once baselines exist it stops scheduling and only
  offers it contextually. Observe is a *phase*, not a fixture — which answers Design's "a scheduled
  feeling has an odd smell": "I'm learning your patterns this week" is honest and self-limiting.
- **The after-state shows nothing, and that ships** — no chart, no history, no streak (§8's scope
  ruling). **Condition:** the coach must *visibly use* it within the first week or two ("the last
  three Sunday evenings you've been on edge — want to move the long run?"). The retention
  mechanism is the coach's memory, not a surface. If people stop logging, that is the signal to
  revisit — the fix is still never a dashboard.
- **"anxious" IS in the word list.** The register bans clinical language *we* impose, not the
  plainest word someone has for their own state; excluding it would make people hunt for a
  euphemism for their own feeling.
- **Never stacked with a grounding close.** A grounding flow already ends on "did that help?";
  asking "how are you doing?" straight after is one prompt too many. If the pairing is ever
  wanted it must *replace* that question, never follow it.

### 4.5 `journal` — deepened (Class 2/3 — the widget is small; the **store** is the module)

- **Modes:** typed; **spoken** — record → STT (commodity job) → show transcript → edit → save.
  Audio discarded after transcription in v1 (cost + privacy; revisit if demand).
- **Prompted or free:** prompt chips from **deterministic banks**, coach-personalized in order
  (`suggest_gratitude_prompts`-class job); blank page always allowed.
- **The journal is a WRITING tool, not a feelings tool (owner ruling 2026-08-04).** Gratitude and
  reflection are *uses*, not the category. A novelist free-writing a scene, morning pages, a
  studio log, a language learner's paragraph, lectio divina — all the same tool, and for someone
  whose habit is writing a novel, "free-write a haunted house scene with a favourite cartoon
  character" is exactly the right prompt. **The coach decides; the app does not get to be
  prescriptive about how the journal gets used.** The coach may therefore **author its own prompt**
  (already supported: `detail` overrides `journal_bank` — "your sentence always wins"), and the
  tool catalog now names the non-reflective uses so the coach knows the breadth is legitimate.
  *This corrects an assistant framing that treated journaling as inherently vulnerable/therapeutic
  — the same **frame leakage** §1 warns about (gym→mind, mind→shell, everyday→crisis), here
  journal→therapy.* **Known gap:** all six shipped banks are reflective (three good things, park a
  worry, a win, savor it, smallest next thing, what's actually true), so the standalone journal
  page still offers a novelist nothing that fits — see §7.
- **Banks (v1):** gratitude (three good things), savor (photo + a line — uses `photo`),
  a win, smallest next thing, "what's actually true," worry-park, evening review (chained).
- **The store (new):** `journal_entries` table — id, user, ts, source occurrence?, bank, text,
  visibility. History = reverse-chron list (module-lite), entries resurface in `recap` ("three
  weeks ago you wrote…" — the memory moat).
- **Privacy:** the coach reads entries by default and says so plainly at first use ("I keep your
  notes so I can know you better — mark anything private and I won't use it"). Per-entry
  **private toggle** excludes from context packs. Export + delete. Scribe `parse_mind_log`
  extracts themes/valence to case notes; never judges.

#### Where journal prompts live (settled 2026-08-04, after building it wrong twice)

**The task owns its prompt; nothing is pooled per user.** Two journal tasks are two goals that
coincidentally share a widget (owner, 2026-08-04) — a novelist's free-write and an evening
gratitude practice must never merge into one chip list.

Three surfaces, three existing homes, **no new table and no new job**:

| surface | where the question comes from |
|---|---|
| scheduled journal step | `prescribe-session` writes `journal_bank` or `detail` on the item; `detail` wins (`journalTool`) |
| adhoc ＋ row | `compose-now-menu` writes `journal_bank` or `journal_prompt`; written wins (`journalOpener`) |
| journal page, opened cold | the twelve banks — the "no task selected" state, which is what deterministic mode also gets |

**Two designs were proposed and dropped, both after checking rather than building:**

1. *A `journal_prompts` table keyed by user, regenerated weekly.* Wrong because it pooled the
   practices — the thing the owner ruling forbids.
2. *Prompts on `activity.target`, crafted at re-plan.* Wrong twice over: `ActivityTarget` requires
   `metric` + `value`, so a journal activity would have carried a bogus metric — and the coach
   **already** writes a fitted question per session, so the machinery was redundant. A live probe
   showed it unprompted: a novelist's "Morning pages" came back with a real free-writing
   instruction, not a gratitude question.

**What the probe did find** is the defect worth fixing: a journal item with *neither* field (a
student's study review) fell through to the hardcoded `'Jot down how it went'` — a line that
presumes a workout and reads as nonsense on a study or free-writing step. Fixed at the source
(prescribe-session must always carry one) and at the last resort (a practice-neutral default).
`probe-coach-tools.ts` now holds novelist and student scenarios so it can't silently return: the
failure mode is a *plausible* prompt for somebody else's practice, which nothing else would catch.

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

### 4.7 `guided_audio` — guided audio player (Class 2 now; Class 3 later)

**v1 = TTS-guided practice** (REQ6's unlock: vetted, frozen scripts → TTS job — no licensing, no
hallucinated URLs, personalizable length): body scan, wind-down, and **loving-kindness /
"kind wishes"** — the self-worth & self-love practice, and the most literal
"bodhisattva-in-training" drill we ship. Player: play/pause, remaining, short/long variant, and a
**sleep mode** (fade + stop-after-N, screen-dark). **Later:** the same player fronts the retrieved
content library (podcast RSS etc., REQ6 §6) — never renders anything a retriever didn't return.

### 4.8 Chained practices — not a new tool

The evening review, thought-reframe (what happened → what I told myself → what's actually true),
and worry-park-then-revisit are **ordered chains of `journal` + `grounding` + `read` steps on a
deterministic tree with coach turns between** — the walkthrough shell already plays ordered
steps. REQ6 §5.2's one-deep stepped program is this pattern grown up: no new engine, new *trees*.

**But chain sparingly — a chain costs the day a node** (owner steer 2026-08-03, ruled in
REQ10 §12). Chaining is what collapses repetition: a strength session's sets would otherwise be
dozens of trail items, so bundling is the only way it works. Mind steps are usually the opposite —
morning breathing and an evening journal are two *occasions*, and chaining them buries three
commitments behind one button on a day that then looks empty. The test is **would they do these
back-to-back in one sitting?** An evening review genuinely is one sitting, so it chains; a day's
mind work generally is not, so it doesn't. A 4–5 step mind chain done once a day is almost always
4–5 separate activities wearing a trench coat.

## 5. Coach configuration — one pattern for everything

Adding a mind tool = the REQ8 recipe, unchanged: a `COACH_TOOLS` entry (summary / trap / fields /
example — the prompt teaches itself via `{{tool_catalog}}`), a client renderer, normalize
whitelist + caps, tests. The coach picks tools by catalog line and fills params on the
`SessionItem`; deterministic banks (breath presets, prompt banks, grounding games, TTS scripts)
live in `@cadence/shared` so the safety-relevant content is code-reviewed, never generated live.
The register rules (§1) go in the coach prompts the same sync-gated way as everything else.

## 6. Build order (one at a time; each independently shippable)

1. **`breathing`** — the signature widget; pure client; ships the pillar. Lands **behind the
   generalized now door** (REQ10 §6 — the door + menu composer are shell work and precede or
   accompany this step), with **the calm surface (chrome A)** and **the crisis rail** — the
   spine everything later inherits.
2. **`meditate`** — extends StepTimer (bells, settle pre-roll, "came back" tap, keep-awake).
3. **`feeling_log`** — small; starts the Observe data flowing (REQ6 §10: instrument demand first).
4. **`grounding`** — the family shell + senses/letters/switch first.
5. **Journal store + written journal** — the module foundation + gratitude banks.
6. **Voice journaling** — STT job on top.
7. **Gratitude share-out** — compose + share sheet.
8. **`guided_audio` v1** — TTS player: body scan, wind-down, loving-kindness.
9. **Chained practices** — evening review → reframe → worry-park (then REQ6's one deep program).
10. **Content library** — horizontal with Fitness, last (REQ6 §6 unchanged).

## 7. Open questions

- ~~Where does the now door live?~~ **Resolved 2026-07-31:** generalized to a neutral,
  plan-relative shell door with a coach-composed menu — see §3.1, REQ10 §6, and
  `design/now-door-brief.md`. Remaining sub-question (Design to recommend): one control with a
  two-tense sheet vs. the ＋/door stack.
- **`SessionItem` params:** typed optional fields per tool (REQ8 idiom) vs. one `params` jsonb —
  decide at `breathing` build time; leaning typed fields + normalize caps.
- **Check-in vocabulary:** which emotion-word set (needs to be granular but not clinical).
- ~~The journal page's chips are reflection-only.~~ **Resolved 2026-08-04 — route (a) shipped:**
  twelve banks across four families (reflection · craft · study · devotion), and the coach picks
  from the family that matches the practice. Route (b) — a per-user weekly prompt-crafting job —
  was **investigated and dropped as redundant**: see "Where prompts live" below.
- ~~Journal retention/export format.~~ **Resolved 2026-08-04 (owner):** entries live **as long as
  the user wants** — nothing auto-expires. They are **exportable as Markdown**, and the user can
  **delete** them. (The "are private entries still parsed" half was already resolved — §8: nothing
  scans them, private means private.) *Unbuilt: export and delete are not implemented yet.*
- **TTS voice** — the coach's voice or a distinct practice voice? Plus **time-to-first-audio** and
  streamed-vs-pre-rendered, which decides whether the guided player needs a loading state at all.
- ~~Where "did it help?" lands in the data model.~~ **Resolved 2026-08-04 (owner): it doesn't —
  the question is retired.** "That sounds like the weekly check-in. Talk to the coach about what's
  working or not working. Let them adjust the plan." The conversation is the better instrument:
  right after a two-minute flow the honest answer often isn't known yet, and a coach that can ask
  in context and change the plan beats a tap that produces a boolean nobody acts on. Removed with
  it: the three-way tap, `StepLog.helped`, and `helped-gate.ts` (the once-a-day cross-surface
  rule, which existed only to make the question tolerable).
  **Consequence, accepted:** Mind's signal into the weekly check-in is now what got logged as done
  or skipped, plus what the person says — which is what the owner ruled it should be.
- ~~Do mind practices log as occurrences with the existing status vocabulary?~~ **Resolved
  2026-08-04 (owner): yes, existing.** `skipped` vs `missed`, freezes and detours all apply
  unchanged — a sit you didn't do is a sit you didn't do, and inventing a parallel vocabulary for
  the mind pillar would have implied it needed gentler accounting than the body pillar. It doesn't.
- ~~The emergency line's copy deck + resource list~~ — **no longer needed** (§8: no emergency
  chrome ships). ~~Should the coach name a specific number (988/911)?~~ **Resolved 2026-08-04
  (owner): no number.** The coach refers to a **medical professional**, as any decent LLM already
  does — "we might get it wrong," and a wrong number is worse than no number (regions differ,
  lines change, and we cannot verify one at runtime). Already the live behaviour: the coach system
  prompt says "a professional, someone they trust, or an emergency or crisis line" and names
  nothing. TERMS-OF-SERVICE.md still names 988 — that is a **legal disclosure, not the coach
  speaking**, so the two do not conflict; revisit only if the terms are rewritten.
- **Library routing** — its own tab, under Mind, or a shared cross-pillar surface? A pricing and
  moderation decision, not a layout one.

## 8. Scope: what the coach notices, and what it doesn't (owner ruling 2026-08-01)

**This replaces the "recognition & trigger" design of 2026-07-31 and withdraws the escalation
ladder with it.** That design proposed scanning every message for distress and rendering crisis
chrome. The owner ruled it out of scope, and the repo's own legal drafts agree: Cadence is "not
medical care, dietary prescription, psychotherapy, or crisis intervention," not a therapist or
crisis counselor, and **"not an emergency service and may not respond in real time."** Building
detection would have manufactured exactly the real-time expectation the terms disclaim — and
detection that exists but misses is a worse posture than no detection with an honest scope.

**The line:** *reason about what people DO; never scan what they SAY for pathology.*

- **In scope — patterns in coaching data.** The coach already holds logged sessions, weights,
  meals, consistency. Noticing "you've done everything we planned for two months and the number
  hasn't moved — worth raising with a doctor" is **responsible coaching, not diagnosis**: it is
  about *the plan not working*, which is the coach's actual job, and it reads data the user gave
  us for coaching. Physical or mental, the move is identical — observe the pattern, suggest a
  professional, never name a condition. (REQ7 `notable_deltas` territory.)
- **Out of scope — content surveillance.** No distress classifier, no per-message safety parse,
  no journal scanning, no sentiment reading. Beyond a coach's remit, corrosive in false positives
  ("this diet is killing me"), and in direct tension with the journal's privacy promise. **This
  also resolves the private-journal fork:** private means private — nothing scans it, so there is
  no ruling left to make.
- **Out of scope — emergency chrome.** No persistent emergency affordance, no crisis card
  component, no resource section in any menu. A standing emergency button inside a habit app
  makes a promise ("we are watching") that we cannot keep. **Phones already dial emergency
  services**; we are not that layer.
- **In scope — the coach's own judgment, in conversation.** If someone tells the coach something
  serious, it responds as any decent LLM does: acknowledge plainly, say this is beyond what a
  coach should carry, encourage them toward a professional. That behavior lives **entirely in the
  system prompt** (`config/ai-admin/cadence-coach.system-prompt.md`) — one warm response in
  context, never a product surface.

**Absence is a habit signal, not a health signal.** Three quiet weeks earns a check-in because
**we help people build habits** — "haven't seen you in a while; want to pick back up, or should we
adjust?" It must never imply we have inferred anything about their wellbeing. Normal life includes
slacking off, a heavy weekend, and chocolate bars nobody logs; the coach treats that as ordinary,
because it is. (Mechanism: the REQ10 §7 tick — still unbuilt.)

**BRAND note:** BRAND's crisis boundary survives intact but is **coach behavior, not machinery** —
its "deterministic vetted copy" should be read as the system-prompt boundary, not a rendered
component.
