# Evaluating prompts with AI Admin's own tools

Don't eval prompts in the abstract — AI Admin ships features that make the loop concrete: **test data**, **diagnostics**, **retries/failover**, and **caching**. Use them.

## The loop

1. **Define expected output** for representative inputs (the golden set).
2. **Store test data** on the job / rule set (default variable values used to run it in the UI).
3. **Run with diagnostics on** to capture exactly what the model returned.
4. **Compare** actual vs expected; classify failures (format / grounding / scope / model).
5. **Refine** the template (one change at a time) and re-run.
6. **Turn diagnostics back to one-time or off** once stable.

## Test data

Jobs and rule sets carry **test data** — example variable values. Seed it with:
- A **typical** case (the happy path).
- An **edge** case: empty input, partial fields, off-topic text.
- A **hostile** case: input containing instruction-like text (verify it's treated as data, not commands — see grounding.md).

A prompt that passes all three on test data is far likelier to survive production.

## Diagnostics

Enable diagnostics (`one-time` or `always`) in the job's advanced settings to log request/response, timing, and token usage.

- Use `one-time` while iterating on a single prompt — it captures the next run without leaving logging on forever.
- Read the logged **raw response** to see whether failures are *format* (broken JSON → fix with build rules) or *content* (wrong/invented values → fix with grounding or a stronger model).
- Token usage tells you if a template is bloated (trim few-shot, shorten context).

## What to check each run

| Dimension | Pass criteria |
|-----------|---------------|
| Format | Parses as JSON; all `outputMappings` keys present and top-level |
| Grounding | No values absent from the input were invented |
| Scope | Step did its one job; didn't drift into the next step's work |
| Stability | Same input → consistent shape across 2–3 runs (lower temp if not) |
| Cost/latency | Token use and time acceptable for the tier (see model-selection.md) |

## Regression discipline

- Change **one thing at a time** (wording, schema, temperature, model) and re-run the golden set.
- When you change the **model** (or test failover), keep the prompt identical first to isolate the variable, then tune.
- Keep the golden expected outputs alongside the job (test data) so the next person — or the next agent edit — can re-verify.

## Quick rubric

- [ ] Golden set with typical + edge + hostile inputs stored as test data.
- [ ] Diagnostics used to inspect at least one real response.
- [ ] Failures classified (format vs content) and fixed at the right layer.
- [ ] Re-run after each single change.
- [ ] Stable across repeated runs before shipping.
