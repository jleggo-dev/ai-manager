<!--
LinkedIn post #1 in the "Building Cadence" series. Draft — first person, edit to taste.
Suggested headline + dek below; body is ~1,000 words, scannable for LinkedIn.
-->

# Teaching an AI Coach to Remember

### Building an agentic memory layer for a lifestyle app — what I borrowed from MemGPT, and where I went my own way.

I'm building **Cadence**, a conversational coach for whatever you're building — a race, better
meals, a steadier mind, a daily practice like writing. Fitness and nutrition are the launch
focus, but the design holds for any of it. You talk to it like a person — "I got out of shape
this winter and I want to run a Spartan Beast in October" — and it captures your goals, builds
you a plan, and adapts as life happens.

The chat was the easy part. The hard part is **memory**.

An LLM has no memory between turns. And over months, a real user generates far more data —
workouts, meals, weigh-ins, injuries, check-ins, the time they tweaked a knee at a wedding —
than will ever fit in a model's context window. So the core question isn't "how do I make a
chatbot." It's: **how do I keep the coach grounded in *your* life without stuffing your
entire life into every prompt?**

Here's how I'm solving it, and why it ended up looking a lot like an operating system.

## The naive version (and why it falls apart)

The obvious move: render everything I know about you into a "dossier" and jam it into the
system prompt. Goals, plan, recent consistency, constraints — all of it, every message.

It works great for about a week. Then three things break:

1. **It overflows.** Three months in, the dossier is bigger than the budget I want to spend
   on context, and most of it is irrelevant to today's conversation.
2. **It quietly kills caching.** Modern model APIs cache your prompt prefix to save money
   and latency. If the changing part of your prompt lives in the system prefix, you bust the
   cache on every turn. (One documented case went from a **7% to an 84%** cache-hit rate by
   doing nothing but moving the mutating bit *out* of the system prompt.)
3. **It's a black box.** The dossier was being assembled in application code. As the person
   responsible for the AI's behavior, I had no clean way to *see* how a given prompt was
   built, or to *tune* it without a deploy. For a health app, that's a non-starter.

The fix wasn't a better string. It was a reframe: **this isn't a query problem, it's a
memory problem.** Treat the coach like an agent with working memory — and curate that memory
deliberately.

## The design, in four ideas

**1. A semantic layer, not raw SQL.**
The tempting shortcut is to let the model write SQL against the database. Don't. Even
read-only, a model-written query can scan a billion rows, lock a table, or leak across
users — and it'll answer the same question two different ways on two different days. Instead,
the AI picks from a **registry of safe, parameterized retrieval functions** — `get_consistency(days)`,
`get_active_plan()`, `get_constraints()`. A bounded, governed action space. The model
*chooses*; my code *executes*. This is the "semantic layer" pattern, and it's where serious
teams have landed for exactly these reasons.

**2. A Broker that curates.**
A cheap, fast model (I call it the Broker) reads a small **catalog** — what data exists, how
much of it, how recent — decides what's worth pulling for the conversation at hand, calls the
right functions, and **summarizes the results into a compact "context pack."** That pack,
not the raw database, is what the coach reasons over.

**3. The pack is working memory, not a transcript.**
It's structured, it carries **provenance** (which functions produced it, and when), and it
has a **TTL**. Today it's curated once per session — a single Broker pass at the moment you
open the coach — and refreshes on that TTL (sooner during onboarding, where things move fast).
The next step is the one that actually earns the phrase "working memory": letting the coach
notice *mid-conversation* that it's missing something and go fetch it itself, instead of
reasoning from a snapshot taken before you said a word. That's a post of its own (#4).

**4. Cache-aware placement.**
The stable persona lives in the cacheable system prefix. The changing context pack goes at
the *end* of the prompt. That one move is the 7%-to-84% trick — and it cleanly separates the
part the platform owns (who the coach is) from the part I inject as data (what it knows about
you right now).

## Where this meets MemGPT — and where it leaves

If this smells like **MemGPT / Letta**, that's because it is, in spirit. MemGPT treats the
context window like RAM and pages memory in and out of an external store; my "context pack"
is essentially its "human" memory block, and my refresh loop is a cousin of its reflection
heartbeat. I'm not pretending I invented memory for agents — I read the same papers everyone
else did.

But Cadence diverges in three deliberate ways:

- **Governed retrieval instead of free search.** MemGPT lets the agent search its own
  archival memory. I put a **semantic layer** in between — parameterized functions over a
  relational store — because this is intimate personal data (someone's body, their grief, their
  practice) and I want every read to be bounded and validated.
- **A separate curator, not pure self-editing.** Rather than the agent rewriting its own
  memory, a dedicated Broker curates the pack; the coach only *signals* when memory feels
  stale. Cheaper, and easier to reason about.
- **An auditable substrate.** It's built on **devs.ai** models behind an orchestration layer
  that logs every retrieval, every prompt, and every token, and lets me tune the prompts as
  managed templates — not code. I can open any conversation and see exactly which functions
  were called, what the Broker summarized, and the precise text the model received. For
  anything touching intimate personal data, that governance isn't a nice-to-have.

## The honest part

None of the individual pieces are new. Text-to-SQL, semantic layers, MemGPT-style memory,
prompt caching — all well-trodden. What I think is *mildly* new is the **assembly**: a
longitudinal personal-coaching agent that uses a metadata-driven semantic layer to feed a
Broker-curated, provenance-tagged working memory, and decides for itself when to refresh.
I'm building it in public, which means I'll be wrong about parts of it — and I'd rather hear
that now than ship it quietly.

## What's next

The next problem is juicier than it sounds: the gap between a **goal** ("run a Spartan in
October") and a **commitment** ("Tuesday: 5k zone-2; Thursday: hill repeats"). Turning a
high-level objective into something you actually execute weekly — and re-planning it when a
knee flares up — is where a coach earns its keep. That's post #2.

If you're building agents that have to remember things over months, follow along — I'll share
the schemas, the failure modes, and the parts that blow up in my face.

*— Building Cadence on devs.ai. Series: post 1 of n.*

---

<!-- DRAFT OUTLINE — Post #2 (planning only, not for publication) -->
## Outline — Post #2: From a Goal to a Plan You Actually Do

**Working title:** "The Gap Between a Goal and a Tuesday"

- **Hook:** "Run a Spartan Beast in October" is a *wish*, not a plan. The hard part isn't
  the goal — it's turning it into something you execute on a Tuesday, and re-planning it
  when your knee flares up.
- **The distinction we under-thought:** high-level **objectives** (outcomes) vs. daily/weekly
  **commitments** (the executable schedule that ladders up to them). OKR-shaped.
- **Why LLMs default to useless here:** they give vague advice ("build a base, do some hills")
  instead of a concrete, trackable schedule. The coached move is "here's a plan — commit to it."
- **The pipeline (and why it's a workflow, not a vibe):** capture the objective → a Broker
  builds a planning brief → the Coach synthesizes commitments → a separate **verifier** vets
  them against injuries/equipment → the user agrees → lock. Each step auditable on devs.ai/AI Admin.
- **Why a separate verifier matters:** a model that writes a plan is the wrong one to grade it;
  show the time the vet step caught an unsafe knee-loading plan.
- **Re-planning when life happens:** additive temporary plans for travel/illness that protect
  your momentum instead of nuking it — and how the memory engine (post #1) feeds the replan.
- **Teaser → Post #3:** the memory engine in production — consistency signals, drift detection,
  and the coach proactively adapting the plan.
