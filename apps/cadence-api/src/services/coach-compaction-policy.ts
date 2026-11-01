import { APP_AUTHORED, PINNED_CONTEXT } from './coach-turns.ts';

/**
 * Injected blocks written once in a while that stay true until the next one, so the newest of each
 * must outlive compaction (HARNESS-V3 P1b, finding C):
 *  - `date` — local date/time, timezone, weather, check-in due (`date-context.ts`). Stamped once
 *    per calendar day per session; dropping it leaves her with no idea what day it is, which is the
 *    exact failure that file exists to prevent.
 *  - `attachments` — what was attached to a message, with the `photo_ref` she names later
 *    (`coach-attach-turn.ts`). Only the newest survives; an older photo lives on in the summary.
 *  - `health-digest` — the Apple Health digest pushed mid-session (`routes/health-digest.ts`).
 * Not here: `turn-context` (sent again every turn), `attachments-failed` (nothing to refer back
 * to), `goal-screen` notes (spoken to on the next turn, then done). Handed to AI Admin as
 * `keepNewestRowPattern`; the capture group is the source the engine keeps one of.
 */
export const KEEP_NEWEST_CONTEXT_SOURCES = ['date', 'attachments', 'health-digest'] as const;
export const KEEP_NEWEST_CONTEXT = new RegExp(`^\\s*<context source="(${KEEP_NEWEST_CONTEXT_SOURCES.join('|')})"`);

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
 *  - `keepTailUnits: 12_000` — the verbatim tail behind the summary, sized in units over EVERY row
 *    in it (injected ones too), as whole exchanges, never fewer than two. Measured 2026-10-31: an
 *    average exchange is ~910 units (user 87 chars + reply 446 + ~3.1k injected), a p90 one ~3.4k
 *    (12.5k injected). So the tail holds ~13 average exchanges (more than the old "ten") or ~3
 *    heavy ones, and after a fold the request is ≈ persona + once-per-session blocks (~8k) +
 *    summary (~0.4k) + tail (≤12k) ≈ 20k, leaving ~22k of room: ~24 average exchanges or ~6 heavy
 *    ones between folds. The old turn count (`keepLastNTurns: 20`, still read by sessions that
 *    carry nothing newer) made a 10-heavy-exchange tail that was itself at the trigger: 50 folds
 *    in 60 exchanges (P1b, finding B).
 *  - `minRemovedUnits: 4_000` — skip a fold that would take out less (every fold loses something;
 *    P3 showed the fold is where facts go). ~4–5 average exchanges, ~1 heavy one, so it stops
 *    exactly the one-exchange folds the turn count produced (~3.4k each), and it sits under
 *    ceiling − trigger (8k), so the after-reply run clears it before a send would wait.
 *  - At compaction, app rows behind the kept tail are DROPPED, not summarized — the per-turn
 *    context is sent again every turn. `pinnedRowPattern` names the blocks sent once per session
 *    (dossier, capability manifest, pick protocol), which stay verbatim (MP33, HARNESS-V3 C2).
 *    `keepNewestRowPattern` names the blocks sent once in a while (KEEP_NEWEST_CONTEXT): the
 *    newest of each is sent again after the summary.
 *
 * History: the old 32k fired near ~60k billed before the units were calibrated; 20k (2026-08-20)
 * fired once in 461 sessions, then re-ran on every message after it (fixed with the mark,
 * HARNESS-V3 C1). Changing these needs `set-coach-persona.ts` re-run, and reaches new sessions
 * only — the engine copies the policy onto the SESSION at open (`chat-session-open.ts`), and an
 * active user's session never goes idle long enough to reopen. `backfill-session-summarizer.ts`
 * carries it onto the sessions already open.
 */
export const COACH_SUMMARIZER = {
  jobSlug: 'coach-compact',
  triggerTokens: 42_000,
  ceilingTokens: 50_000,
  keepLastNTurns: 20,
  keepTailUnits: 12_000,
  minRemovedUnits: 4_000,
  appRowPattern: APP_AUTHORED.source,
  pinnedRowPattern: PINNED_CONTEXT.source,
  keepNewestRowPattern: KEEP_NEWEST_CONTEXT.source,
} as const;
