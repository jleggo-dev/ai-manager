import { APP_AUTHORED, PINNED_CONTEXT } from './coach-turns.ts';

/**
 * How long a conversation may grow before the older half becomes a summary.
 *
 * Policy lives HERE, read by the persona script (`scripts/set-coach-persona.ts`) and the compaction
 * eval (`scripts/eval-compaction.ts`), because it is a coaching decision; the mechanism lives in
 * the engine (`backend/src/services/session-compaction.ts`), which owns the transcript and the
 * request, and therefore survives a change of provider. Threading (#250) moved the transcript to
 * the provider and the bill still grew ~594/turn with nothing bounding it (measured 2026-08-20,
 * probe-thread-turns.ts) — so the bound is ours to own, and this is it.
 *
 * CALIBRATED FOR QUALITY, NOT COST (owner, 2026-08-20: "quality is more important than cost —
 * 100K per message isn't indicative of quality though"). Both halves of that sentence are the
 * spec: a huge context is ANTI-quality — the measured tool-calling refusal happened at ~119k —
 * and an over-eager summary that eats live conversation is too. So the working set stays
 * generous and bounded:
 *
 *  - Units are `estimateSessionTokens` units — char/4 over the history that will be SENT
 *    (persona + summary + everything after the summary mark) — and real billed tokens run ~1.78×
 *    that (solved against production billing, 2026-08-19).
 *  - `triggerTokens: 42_000` ≈ **75K billed** (owner, 2026-10-31: "compact around 75K"). Runs AFTER
 *    her reply (`compactCoachSessionAfterReply`), so nobody waits on it. Well under the measured
 *    failure point: she stopped calling tools at ~119k.
 *  - `ceilingTokens: 50_000` ≈ 89K billed: the only point where a send waits on a summarizer — when
 *    the after-reply run failed or has not landed. Still under ~119k.
 *  - `keepLastNTurns: 20` counts real TURNS — ten exchanges verbatim behind the summary — because
 *    `appRowPattern` stops the injected `<context>`/`<note>` rows from using up the count. Before
 *    2026-10-31 they did, and "ten exchanges" was closer to four.
 *  - At compaction, app rows behind the kept tail are DROPPED, not summarized — the per-turn
 *    context is sent again every turn. `pinnedRowPattern` names the blocks sent once per session
 *    (dossier, capability manifest, pick protocol), which stay verbatim (MP33, HARNESS-V3 C2).
 *
 * History: the old 32k fired near ~60k billed before the units were calibrated; 20k (2026-08-20)
 * fired once in 461 sessions, then re-ran on every message after it (fixed with the mark,
 * HARNESS-V3 C1). Changing these needs a re-run of this script and reaches new sessions only — the
 * engine copies the policy onto the SESSION at open (`chat-session-open.ts`).
 */
export const COACH_SUMMARIZER = {
  jobSlug: 'coach-compact',
  triggerTokens: 42_000,
  ceilingTokens: 50_000,
  keepLastNTurns: 20,
  appRowPattern: APP_AUTHORED.source,
  pinnedRowPattern: PINNED_CONTEXT.source,
} as const;
