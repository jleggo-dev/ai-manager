# Model Selection for AI Admin steps

AI Admin connects to two provider types. The prompt-engineering decision is rarely "which vendor" — it's "which capability tier and which mode for *this step*."

## The two provider types

| Provider | What it is | Profile type | Strengths |
|----------|-----------|--------------|-----------|
| **Devs.ai** | An **aggregator** that fronts nearly every text LLM (and many image models) on the market | `agent` or `model` | Widest model choice; **agents** add MCP tools, web search, data sources, OAuth, native conversation memory |
| **Google Gemini** | Direct Gemini API access | `model` only | Grounding with Google Search; direct/low-overhead model calls |

Because Devs.ai is a near-universal aggregator, you usually have *every* model available through one provider. So choose by **task fit, cost, and latency**, not by vendor lock-in.

## Agent vs model (Devs.ai)

- **Agent** — a Devs.ai agent with MCP tools (Gmail, Drive, web search…), data sources, and provider-side memory. Use when the step must *act* or *fetch live/external data*. Prompts can rely on tool use; keep instructions about *when* to use which tool explicit.
- **Model** — a raw LLM id (e.g. a GPT/Claude/Gemini model). Use for pure prompt-in/text-out work: extraction, classification, synthesis. Most processing-job steps are `model`.

> If a step needs fresh web data, prefer a Devs.ai **agent** with web search (or a Gemini profile with Google Search grounding) over instructing a plain model to "search" — a plain model can't, and will hallucinate.

## Pick a capability tier per step

You don't need one model for the whole workflow — assign profiles per job.

| Step character | Tier | Temperature | Why |
|----------------|------|-------------|-----|
| Complex reasoning, research, synthesis | Strongest available model | 0.3–0.5 | Instruction-following + judgment |
| Extraction / strict JSON output | Mid-tier | 0.1–0.3 | Low temp = stable JSON |
| Classification, routing, **validation/repair** | Cheapest fast model (e.g. `gemini-2.0-flash`) | 0.1–0.2 | High volume, simple decision, latency-sensitive |
| Creative drafting / variants | Strong model | 0.7–0.9 | Diversity of output |

Mixed-tier workflow example: strong model to *analyze* → cheap fast model to *verify the output* (see output-verification.md) → strong model to *write the report*. This is both cheaper and more reliable than one big model everywhere.

## Failover prompt parity (important & easy to miss)

Every profile can set a **failover provider + model** (with its own runtime options). If the primary errors or returns empty, AI Admin retries on the failover automatically.

**A prompt that depends on quirks of one model can break on the failover.** Keep templates model-agnostic:

- Don't rely on a specific model's reasoning style, tool names, or token limits.
- Put the JSON/output contract in the prompt itself, not in model-specific params, so it holds on either model.
- If primary and failover differ in JSON discipline, lean on deterministic build rules (`trim-to-json`/`repair-json`) so output is normalized regardless of which model answered.
- Test the template against both the primary and failover model when the step is critical.

## Runtime options worth knowing

- **Devs.ai:** built-in web search, Python execution, spreadsheet, memory, sandbox; citation generation; parallel tool calls. Write prompts that *invite* tool use when these are on.
- **Gemini:** grounding with Google Search. With grounding on, instruct the model to cite/anchor; with it off, ground against provided data only (see grounding.md).
- **Temperature:** lower for JSON/extraction/validation, higher for creative steps. Set per profile, not per prompt.

## Checklist

- [ ] Tier matches the step's job (don't pay for a frontier model to classify).
- [ ] Validation/repair steps use a cheap fast model.
- [ ] Web/live-data steps use an agent or Gemini-with-Search, not a plain model told to "search".
- [ ] Template is model-agnostic enough to survive failover.
- [ ] Output contract lives in the prompt + build rules, not model-specific params.
