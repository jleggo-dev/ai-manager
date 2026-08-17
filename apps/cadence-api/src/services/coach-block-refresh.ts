/**
 * A session keeps the instructions it was born with. This is what changes that.
 *
 * Two blocks ride in at session open and never again: the capability manifest
 * (`coach-capabilities.ts`) and the quick-pick protocol (`coach-picks-protocol.ts`). Both ship in
 * CODE rather than in the persona, precisely so they can be corrected in a deploy — but a session
 * survives seven days of idling (`STALE_IDLE_MS`), so "corrected in a deploy" has meant "corrected
 * for whoever happens to open a new thread afterwards".
 *
 * What that cost, measured. The owner's live session opened 2026-08-15. On 2026-08-16 two fixes
 * were written for one failure — the coach promising a plan change in prose and never calling
 * `propose_plan_change`. Neither reached him. His session was still carrying a capability block
 * with no "DO THESE, DO NOT DESCRIBE THEM" line, and a pick protocol that told her to emit
 * `layout: "change"` after the tool call — a tag `coercePicks` deliberately drops. So she emitted
 * it, believed a card was up, and nothing appeared. On 2026-08-17, five of eighteen assistant turns
 * promised an action with no tool call, two of them after the fix had shipped.
 *
 * So: on every message, check whether what this session was handed still matches what the build
 * renders today, and hand it the current version when it does not.
 *
 * THE COST GATE. The two blocks are ~6.5KB / ~1.7k tokens together — far too expensive to re-send
 * per turn. Three things keep an unchanged session at exactly zero added tokens:
 *  - a per-process memo, so a session verified once costs a Map lookup forever after;
 *  - on a miss, ONE history read for both blocks, compared against the renderings this build can
 *    produce — an exact match ends it;
 *  - nothing is written unless a comparison actually differs.
 *
 * THE SUPERSEDE PROBLEM, which is the reason the preamble below exists. A re-injected block does
 * not delete the old one: both sit in the session history and both reach the model, now that
 * continuations carry the full conversation. Two contradictory instruction blocks is a worse
 * failure than one stale block — the model would be free to read the old `layout: "change"` line as
 * an extra step that still stands. So every block, at session open and on refresh alike, opens by
 * naming its own `source` and stating that anything appearing only in an older copy is WITHDRAWN.
 * It rides the session-open injection unchanged for a mechanical reason as well as a rhetorical
 * one: the comparison below is an exact string match, so the text a session opens with has to be
 * the identical text a refresh would produce.
 *
 * NO MIGRATION. The record of what a session was handed is the session's own history —
 * `injectCoachContext` writes each block as a `<context source="..." version="..." built_at="...">`
 * turn — so the previous content is read back out of `getCoachHistory`, `built_at` and every other
 * wrapper attribute ignored.
 */
import { createHash } from 'node:crypto';
import { getCoachHistory, injectCoachContext } from '../ai/aim.ts';
import { renderCapabilities } from './coach-capabilities.ts';
import { renderPickProtocol } from './coach-picks-protocol.ts';

/** Everything the two renderers branch on. Session open has all of it; a refresh recovers it. */
export interface CoachBlockOpts {
  healthAvailable?: boolean;
  healthAnswered?: boolean;
  intent?: string;
}

/**
 * Wrapper provenance version. Was 1 for the whole life of these blocks; bumped when the supersede
 * preamble became part of the body, so an admin reading a transcript can tell the two apart.
 */
const BLOCK_VERSION = 2;

/**
 * The line that makes a second copy safe.
 *
 * Stated as a condition ("if an earlier block…") so the same words are correct at session open,
 * where there is no earlier copy, and decisive on a refresh, where there is. The last clause is the
 * load-bearing one: the old text's failure mode is a rule that exists ONLY in the old copy, and
 * without it the model is free to treat that rule as additive rather than as replaced.
 */
export function supersedeHeader(source: string): string {
  return [
    `== SUPERSEDES ANY EARLIER "${source}" BLOCK ==`,
    `This is the current one. If a block marked source="${source}" appears earlier in this conversation, it was ` +
      'written before the app changed and is now wrong — follow this one wherever they differ, and treat anything ' +
      'that appears ONLY in the older copy as withdrawn, not as an extra rule that still stands.',
  ].join('\n');
}

interface BlockSpec {
  /** The `source` on the `<context>` wrapper — the key a block is matched by across a session. */
  source: string;
  /** Render the body for one set of options. Pure: same options in, same string out. */
  render(opts: CoachBlockOpts): string;
  /**
   * Every option set that renders DIFFERENTLY — two per block today. Two jobs: it is the candidate
   * list an existing block is matched against, and it is the closed set a refresh may inject from,
   * which is what guarantees a refreshed block matches on the next turn instead of re-injecting
   * forever. The `exhaustive` tests hold the renderers to it.
   */
  variants: CoachBlockOpts[];
  /**
   * Which variant a block already in the history was rendered as. The message path knows nothing
   * about the device or the session's intent — only the block itself does — and guessing wrong is
   * expensive in both directions: telling a phone Apple Health is unavailable, or pulling the
   * first-conversation script out from under a session still in onboarding.
   */
  variantOf(previous: string): CoachBlockOpts;
}

/** The one line `renderCapabilities` emits when the device cannot read Apple Health. */
const NO_HEALTH_MARKER = 'Not on this device: Apple Health';
/** The heading `renderPickProtocol` adds only for `intent: 'onboarding'`. */
const ONBOARDING_MARKER = '== FIRST CONVERSATION';

const BLOCKS: BlockSpec[] = [
  {
    source: 'capabilities',
    render: (o) => renderCapabilities({ healthAvailable: o.healthAvailable, healthAnswered: o.healthAnswered }),
    variants: [{ healthAvailable: true }, { healthAvailable: false }],
    variantOf: (previous) => ({ healthAvailable: !previous.includes(NO_HEALTH_MARKER) }),
  },
  {
    source: 'pick-protocol',
    render: (o) => renderPickProtocol({ intent: o.intent }),
    variants: [{ intent: 'onboarding' }, {}],
    variantOf: (previous) => (previous.includes(ONBOARDING_MARKER) ? { intent: 'onboarding' } : {}),
  },
];

/** The body actually injected: the supersede preamble, then the block. */
function compose(spec: BlockSpec, opts: CoachBlockOpts): string {
  return `${supersedeHeader(spec.source)}\n${spec.render(opts)}`;
}

/** Every body this build can produce, per source. Memoized — the renderers are pure and ~6.5KB. */
let candidateCache: Map<string, string[]> | null = null;
function candidates(): Map<string, string[]> {
  if (!candidateCache) {
    candidateCache = new Map(BLOCKS.map((spec) => [spec.source, spec.variants.map((v) => compose(spec, v))]));
  }
  return candidateCache;
}

/** One string that changes exactly when the rendered blocks do — i.e. on a deploy that edits them. */
let fingerprintCache: string | null = null;
function buildFingerprint(): string {
  if (fingerprintCache === null) {
    const all = [...candidates().values()].flat().join(' ');
    fingerprintCache = createHash('sha256').update(all).digest('hex').slice(0, 16);
  }
  return fingerprintCache;
}

/**
 * Sessions already known to hold the current text — the whole point of the gate: a returning
 * session costs one Map lookup per turn and no history read at all. Bounded, because this is a
 * per-process memo over an unbounded key space and dropping it only costs one extra history read.
 */
const MAX_TRACKED = 2_000;
const verified = new Map<string, string>();
function remember(sessionId: string): void {
  if (verified.size >= MAX_TRACKED) verified.clear();
  verified.set(sessionId, buildFingerprint());
}

/**
 * One `<context>` turn, unwrapped. Only `source` is read off the tag: `built_at` changes on every
 * injection and `version` on every format change, and neither is what "did the content change"
 * means. Returns null for anything that is not one of these wrappers (a real turn, a `<note>`).
 */
export function parseContextTurn(content: string): { source: string; body: string } | null {
  const m = /^<context\s+([^>]*)>\n?([\s\S]*?)\n?<\/context>$/.exec(content.trim());
  if (!m) return null;
  const source = /\bsource="([^"]*)"/.exec(m[1] ?? '')?.[1];
  return source ? { source, body: m[2] ?? '' } : null;
}

/** The most recent body per source. History is chronological, so the last write wins. */
async function latestBodies(userId: string, sessionId: string): Promise<Map<string, string>> {
  const hist = (await getCoachHistory(userId, sessionId)) as { messages?: unknown; data?: unknown };
  const msgs = (hist.messages ?? hist.data ?? []) as Array<{ content?: string }>;
  const out = new Map<string, string>();
  for (const m of msgs) {
    const parsed = parseContextTurn(m.content ?? '');
    if (parsed && candidates().has(parsed.source)) out.set(parsed.source, parsed.body);
  }
  return out;
}

/**
 * Session open — the FIRST copy of both blocks, composed by the same code a refresh uses so the two
 * can never drift apart. Also marks the session verified, so its first message skips the read.
 */
export async function injectCoachBlocks(userId: string, sessionId: string, opts: CoachBlockOpts): Promise<void> {
  for (const spec of BLOCKS) {
    await injectCoachContext(userId, sessionId, compose(spec, opts), { source: spec.source, version: BLOCK_VERSION });
  }
  remember(sessionId);
}

/**
 * The refresh. Returns the sources it re-injected — `[]` for the overwhelmingly common case of a
 * session that is already current, and `[]` again for any failure.
 *
 * NEVER THROWS, and never leaves a turn waiting on a fault: this is bookkeeping about instructions,
 * and nobody mid-sentence should lose their reply over it. A failure also deliberately does NOT
 * mark the session verified, so the next turn tries again.
 *
 * A source with no block at all in the history is skipped rather than injected fresh. Every session
 * gets both at open, so absence means a session older than the block — and there is nothing in it
 * to recover the variant from. A guess here would tell a web user to go read their Apple Health.
 */
export async function refreshChangedBlocks(userId: string, sessionId: string): Promise<string[]> {
  if (verified.get(sessionId) === buildFingerprint()) return [];
  try {
    const previous = await latestBodies(userId, sessionId);
    const refreshed: string[] = [];
    for (const spec of BLOCKS) {
      const prev = previous.get(spec.source);
      if (prev === undefined) continue;
      if (candidates().get(spec.source)?.includes(prev)) continue;
      await injectCoachContext(userId, sessionId, compose(spec, spec.variantOf(prev)), {
        source: spec.source,
        version: BLOCK_VERSION,
      });
      refreshed.push(spec.source);
    }
    if (refreshed.length) console.log('[coach-block-refresh] re-injected', refreshed.join(', '), 'for', sessionId);
    remember(sessionId);
    return refreshed;
  } catch (e) {
    console.error('[coach-block-refresh]', e);
    return [];
  }
}

/** Test seam — forget which sessions have been checked, and any memoized rendering. */
export function __resetCoachBlockRefreshForTests(): void {
  verified.clear();
  candidateCache = null;
  fingerprintCache = null;
}
