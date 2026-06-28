# Output Verification: did we get what we expected?

The real question behind every JSON-repair rule is broader: **"Did the model output what we expected, in the format we needed?"** JSON repair only answers it for *recoverable* format slips. The dangerous failures are the ones where there's nothing to repair — the model returned no JSON at all, refused, went off-topic, or produced a schema-valid answer with wrong values.

Frame every job's output as a **contract**: required presence, required shape, required content. Verification is checking the response against that contract and recovering when it fails.

## Failure taxonomy (and what catches each)

| Failure | Example | Caught by |
|---------|---------|-----------|
| **Format slip** | JSON wrapped in prose / code fences / preamble | Deterministic build rules (`trim-to-json`, `repair-json`) |
| **No usable output** | Refusal, empty string, pure prose, "I can't help with that", off-topic answer | **Nothing automatic** — needs explicit detection + recovery |
| **Schema-valid but wrong** | Hallucinated number, wrong enum, out-of-range value, invented field | Grounding (prevent) + LLM verifier (detect) |
| **Partial** | Missing required keys, empty where data existed | Assertion on required keys + verifier |
| **Provider error / empty** | Timeout, 5xx, empty response | Retries + failover (automatic) |

> **The gap AI Admin does NOT auto-cover:** a *successful* response that's the wrong shape or content. `repair-json` needs JSON to exist; **failover only fires on errors/empty responses** (a chatty prose answer counts as success); **job retries fire on failures, not on a wrong-but-successful answer**. Closing that gap is the whole point of verification.

## The verification ladder

Apply top-down; stop at the lowest rung that guarantees correctness for the step's stakes.

### Rung 0 — Prevent (cheapest)

The clearer the contract, the less you verify. From the other references: explicit flat schema, `expectedResponseFormat: "json"`, few-shot exemplar, grounding rules ("use only provided data; null if absent"). Most format failures disappear here.

### Rung 1 — Deterministic repair (free, no LLM call)

Chain build rules on the job. They fix *recoverable* format slips with zero latency/cost:

| Order | Rule | Fixes |
|-------|------|-------|
| 1 | `remove-reasoning` | Strips thinking tags / preamble before the JSON |
| 2 | `trim-to-json` | Isolates the `{...}` block from prose / code fences |
| 3 | `repair-json` | Trailing commas, unquoted keys, truncation |

(For CSV: `trim-to-csv` → `repair-csv` or `csv-to-json`.) **Limit:** if the response contains *no* JSON, there is nothing to trim or repair — this rung passes broken-but-empty output downstream. That's why Rung 2 exists.

> Streaming: only `remove-reasoning` / `remove-footnote-tags` run delta-by-delta; the rest run on the full accumulated response after the stream completes — which is when `outputMappings` parsing happens, so they still apply.

### Rung 2 — Detect (assert the contract)

After repair, *assert* the output actually meets the contract. Two places to do it:

- **App-side** (after reading `workflow_variables` or a job result): check that required variables are non-empty and parse as expected. Cheapest reliable detection — do this whenever the calling app consumes the output.
- **In-workflow verifier step** (when a later *step* depends on the value): a cheap-fast LLM step that inspects the prior output and reports/repairs.

What to assert:
- **Presence** — response is non-empty and not a known refusal pattern ("I cannot", "As an AI…", apology-only).
- **Parseability** — `JSON.parse` succeeds (this is what catches *"no JSON at all"*).
- **Required keys** — every `outputMappings` key is present and top-level.
- **Types / enums / ranges** — `score` is a number 0–100; `tier ∈ {A,B,C}`.
- **On-topic** — the answer addresses the asked task, not something else.

### Rung 3 — Repair or regenerate with an LLM (when deterministic can't)

When a wrong/missing value would poison downstream steps, add a **verifier step** using a low-cost, low-latency model (e.g. `gemini-2.0-flash`) on its own profile. It either repairs the prior output into a clean schema *or*, when there's nothing usable, flags it so you can recover.

```
You verify another step's output against a fixed contract.

<user_input>
{{previous_output}}
</user_input>

Required schema (all keys present, correct types):
{ "score": 0, "tier": "A | B | C", "reasons": ["string"] }

Decide:
1. If the input already satisfies the schema, return it unchanged.
2. If it is malformed/wrapped/missing keys but the needed information is present,
   repair it: coerce types, add missing keys with null/[]/defaults,
   constrain "tier" to A|B|C (use "C" if unclear).
3. If the input is NOT an attempt at this task at all — empty, a refusal,
   off-topic prose, or no recoverable values — DO NOT invent data. Return:
   { "verified": false, "reason": "<short why>", "score": null, "tier": null, "reasons": [] }

Respond with ONLY the JSON. No explanation.
```

Set `expectedResponseFormat: "json"` and the same build rules on the verifier job too. Note rung 2 is folded in: the verifier *detects* "no usable output" (case 3) instead of fabricating — that's the case deterministic repair silently fails.

### Rung 4 — Recover (decide what to do on `verified: false`)

Verification is only useful if you act on it. Pick a recovery per step:

| Strategy | When |
|----------|------|
| **Regenerate** — re-run the generating step, ideally with a stronger contract or a more capable model | Transient or low-quality output; cost of a retry is acceptable |
| **Escalate model** — retry on a higher-tier model (or trigger failover) | A weak model keeps missing the schema |
| **Fallback default** — proceed with a safe default value | A missing field is non-critical |
| **Flag for human** — branch your app on `verified === false` | High-stakes; a wrong value is worse than a pause |
| **Hard-fail the step** — stop the workflow with a clear error | Downstream is meaningless without this value |

The worst choice is **silent default to a guess** — that's how a "no JSON" failure turns into confidently-wrong downstream results.

## Wiring a verifier into a workflow

```
Step 1  generate-analysis   → raw output            (depends_on: [])
Step 2  verify-analysis     → clean JSON + verified  (depends_on: [generate-analysis])
        inputMappings:  { "previous_output": "generate-analysis.response" }
        outputMappings: { "verified": "analysis_ok", "score": "lead_score",
                          "tier": "lead_tier", "reasons": "lead_reasons" }
Step 3  route-lead          → reads lead_*, branches on analysis_ok
                              (depends_on: [verify-analysis])
```

Map the verifier's *input* from auto-captured `generate-analysis.response`; take trusted values from the verifier's `outputMappings` so only verified data enters the pipeline.

## Choosing how far up the ladder to go

| Situation | Go to rung |
|-----------|-----------|
| Final human-facing free-form text (no contract) | 0 only |
| Simple flat schema, low stakes | 0–1 |
| App consumes the output directly | 0–2 (assert app-side) |
| A later **step** depends on the value | 0–3 (verifier step) |
| Wrong/missing value silently corrupts results | 0–4 (verify + explicit recovery) |

## Other reliability levers (job config)

- **Retries** — re-attempt on *failure* (provider errors), not on wrong-but-successful output.
- **Failover** — backup model on error/empty only (won't catch prose-instead-of-JSON).
- **Caching** — TTL on responses; avoid for non-deterministic creative steps.
- **Diagnostics** — log request/response to see what the model *actually* returned (see evaluation.md).

## Checklist

- [ ] Output contract is explicit (presence + shape + content).
- [ ] Rung 1 build rules on JSON jobs (`remove-reasoning` → `trim-to-json` → `repair-json`).
- [ ] Something **asserts** the contract — app-side check or verifier step — incl. the "no JSON at all" case.
- [ ] Verifier flags unrecoverable output (`verified: false`) instead of fabricating.
- [ ] An explicit **recovery** is chosen for failed verification (regenerate / escalate / fallback / flag / fail).
- [ ] No silent default-to-guess on missing/critical values.
