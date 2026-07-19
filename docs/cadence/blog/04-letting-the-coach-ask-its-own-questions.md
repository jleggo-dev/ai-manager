<!--
LinkedIn post #4 in the "Building Cadence" series. Draft — first person, edit to taste.
~1,050 words, scannable for LinkedIn. Companion to PLAN.md "Final step — the agentic retrieval loop".
-->

# Letting the Coach Ask Its Own Questions

### My AI coach decides what to look up about you *before you say a word*. Here's why that caps accuracy — and why the fix is a swap, not a rebuild.

In my first post I described how **Cadence** — a conversational coach for whatever you're
building — stays grounded in your life without stuffing your whole history into every prompt.
A cheap, fast model I call the **Broker** curates a compact "context pack": it reads a catalog
of what data exists, picks which safe retrieval functions to call (`get_consistency`,
`get_constraints`, `get_active_plan`), runs them, and summarizes the results into a grounding
block the coach reasons over.

I still think that's the right spine. But I want to be honest about its ceiling.

## The pack is a guess made before the conversation starts

The Broker curates it **once, at the moment you open a session** — before you've said anything.
It's an educated guess about what *this* conversation will need. And a single guess, however
good, can't react to what it finds.

Here's the failure that keeps me up. You open the coach after a rough week. The Broker pulls
your consistency — down from last week. Good pull. But now the *interesting* question is one the
Broker couldn't have known to ask: is there an active constraint that explains the dip — a
flared knee, a bad stretch of grief, a night-shift week? That second lookup would change what
the coach says. It never happens. The coach answers from the snapshot it was handed — or, worse,
fills the gap the way language models fill gaps: by pattern-completing something plausible. In a
coaching app, "plausible" is a synonym for "made up."

## The fix is to let the coach ask its own questions

Instead of the Broker pre-fetching once, the coach itself gets the retrieval functions as
**tools** and calls them mid-conversation — check consistency, see the dip, decide it needs
constraints, fetch those, *then* answer. This is the plain agentic tool-use loop: the model calls
a tool, sees the result, and that result changes its next move. It's how every "agent" you've
heard of actually works.

The part I want to stress: **this is not a new system.** The semantic layer — a bounded registry
of safe, parameterized functions where the model *chooses* and my code *executes* — is already
built. The governed execution boundary is already built. The audit substrate that logs every
retrieval is already built. The per-turn injection hook is even sitting there in the code, today,
as a no-op with a `TODO`. What changes is *who drives*: the Broker's one blind pre-fetch becomes
the coach's own on-demand reads. The harness is a swap of the orchestration layer — not a teardown.

## There's a middle gear I under-appreciated

It isn't binary — one blind pre-fetch versus a fully autonomous loop. There's a spectrum, and the
seam is that **the coach can talk to the Broker.** Rather than the Broker guessing what to pull,
the coach can hand it explicit directions — "I need the last 30 days of consistency and any active
constraints" — and let the Broker execute. That's less guessing without a full rebuild: add one
mid-conversation re-fetch hop, or let the coach direct the retrieval, and you've closed most of the
accuracy gap while keeping the cheap, governed curator in the loop.

## The honest trade-offs

A tool loop is not free accuracy. It buys you accuracy *only when the model actually chases its
uncertainty* — and it introduces failure modes a single pre-fetch doesn't have:

- **More round-trips.** Each hop is another model call. I care more about the coach being right
  than about shaving latency, so I'll pay this — but it's real, and it's a bad trade for a product
  where a fixed context pack already covers what needs saying.
- **New ways to be wrong.** The model can call the wrong tool, hallucinate an argument, or — the
  most common one — stop *one hop too early* and answer confidently on an incomplete picture.
  Handing a model tools doesn't make it more careful. It makes it more capable, in both directions.

The mitigation isn't more infrastructure — it's discipline in two places. Tool *descriptions* that
say **when** to call each function, not just what it returns. And a hard grounding norm in the
coach's persona: **never state a number, a date, or a status you didn't just retrieve this turn.**
That's the same instinct as Cadence's plan-verifier, which flags a plan "unverified" rather than
inventing a detail — applied to the coach's factual claims instead of the plan's.

## Why I'm finalizing the current design first

The tempting mistake would be to treat the single-shot pack as a detour and rip it out for the
loop. It isn't a detour. Shipping it **builds the loop's foundation** — the registry, the governed
boundary, the audit trail, the injection hook. Finalizing the working thing doesn't move me away
from the agentic coach; it gets me measurably closer, because every piece the loop needs is a piece
I'm hardening now.

So the sequence is deliberate: ship the model that works, then — if the guessing bites — add a
re-fetch hop or two to shrink it, and keep the full tool-runner loop as the *final* enhancement
rather than a prerequisite for everything before it. The harness is a swap away, not a rewrite.

## What's next

The plan engine is already live — Cadence turns an objective into weekly commitments and re-plans
when life happens (that's its own post). The retrieval loop is the last big architectural move: the
coach that notices, mid-sentence, that it doesn't know something — and goes and finds out.

If you're building agents that have to be *right* about someone's life over months, follow along —
I'll share the loop, the guardrails that keep it from confidently guessing, and the parts that blow
up in my face.

*— Building Cadence on devs.ai. Series: post 4 of n.*
