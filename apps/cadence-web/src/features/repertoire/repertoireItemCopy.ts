/**
 * Pure copy + formatting for the item screen (P2: the item, opened) — the standing words and
 * their one-line explanations, the tempo caption, and the history dates. Split from ItemScreen.tsx
 * so the logic (a `.ts` file, function-capped at 150 lines by eslint.config.sizes.mjs) stays
 * separate from the render tree, and so each piece is table-testable on its own.
 *
 * LLM-facing text this is not — every string here is read by a PERSON on a settings-shaped
 * screen, so it uses the coach's plain, warm "I" voice (BRAND.md), never the imperative,
 * list-shaped style job prompts and tool descriptions use.
 */
import type { RepertoireItem } from '@cadence/shared';
import { DEFAULT_METER, type MetronomeSpec, settledTempo, tempoMarking } from '@cadence/shared';

/** The four standings, in the order the control shows them (owner design 2026-09-02). */
export const STANDING_ORDER: RepertoireItem['status'][] = ['queued', 'working', 'known', 'retired'];

/** Schema word → the word on the button. Warm words in the UI, boring words in the schema
 *  (CLAUDE.md's nomenclature rule) — never invert this mapping at a second call site. */
export const STANDING_WORDS: Record<RepertoireItem['status'], string> = {
  queued: 'Up next',
  working: 'Learning',
  known: 'Keeping up',
  retired: 'Learned',
};

/**
 * The one line under the control, saying what the CHOSEN standing MEANS, in the coach's own "I"
 * voice — the same four definitions she reads (`STANDING_MEANS` in @cadence/shared), warm rather
 * than boring, per CLAUDE.md's nomenclature split.
 *
 * They described machinery until 2026-09-03: a rotation ordered by rest, warm-ups and play-outs
 * drawn from Keeping up, an item she would suggest next, a group she would never schedule. The
 * owner deleted all of that (*"we don't need to give the coach ANY direction on how to pick"*), and
 * copy describing a mechanism the app no longer runs is a promise it quietly stops keeping. The one
 * line that survived is Up next's, because "nothing starts unless you ask" is a consent boundary
 * rather than a picking rule — and it is a promise the app does still keep.
 */
export const STANDING_EXPLANATION: Record<RepertoireItem['status'], string> = {
  queued: "Up next — not started yet, in your order. I won't start one unless you ask.",
  working: "Learning — what you're working on now.",
  known: 'Keeping up — learned, and still played.',
  retired: 'Learned — finished. Bring it back any time.',
};

/**
 * Books — a record, not a repertoire (P8): `kind: 'book'` exactly (case-insensitive, trimmed),
 * the one canonical spelling, not a fuzzy match against the coach's free-text `kind` field. A
 * looser match risks a false positive on some other domain's kind that happens to contain the
 * word; an exact one is a router CLAUDE.md's own rule asks for a table test on, which
 * `repertoireItemCopy.test.ts` and `repertoireListCopy.test.ts` both carry.
 */
export function isBookKind(kind: string | null | undefined): boolean {
  return (kind ?? '').trim().toLowerCase() === 'book';
}

/** The standing word for one item's own status. Identical to `STANDING_WORDS` for every standing
 *  and every domain except one: a book's Learned standing reads "Finished" — "Learned" reads oddly
 *  for a record that was simply read to the end (the design's own word swap, P8). Lives beside
 *  `STANDING_WORDS` (rather than in repertoireListCopy.ts, which imports FROM this file already —
 *  the reverse import would be a cycle) so every reader of a standing word, the list row's own
 *  right-side label and move-menu AND this screen's own header caption below, reads the same
 *  domain-aware word from one place. */
export function standingWordFor(kind: string | null | undefined, status: RepertoireItem['status']): string {
  if (status === 'retired' && isBookKind(kind)) return 'Finished';
  return STANDING_WORDS[status];
}

/** Hardcoded rather than `toLocaleDateString`'s month name — locale-independent, so the same
 *  item reads the same way on every device (the shared repertoire renderer's own reasoning).
 *  Exported for the list screen's own (coarser) date grammar, `repertoireListCopy.ts` — same
 *  twelve names, never a second array to keep in step with this one. */
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Mar 14' this year, 'Mar 14, 2025' otherwise — an absolute date for a HISTORY row, which
 *  spans years, not a relative one (cardHeader.ts's `deadlineTag` uses the same escalation). */
export function formatDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const month = MONTH_ABBR[d.getMonth()];
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear ? `${month} ${d.getDate()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

/** 'Mar' — the caption line's compact learned-month segment. Never invents one: a backfilled
 *  item's absent `learned_at` means no segment at all, handled by the caller, not by this. */
export function monthAbbr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : (MONTH_ABBR[d.getMonth()] ?? '');
}

/** How long ago something was practiced, three tiers: relative under two weeks (today/yesterday/N
 *  days ago), then a bare date, escalating from month-only to month+year exactly like
 *  `formatDate`'s own two forms once it crosses into a different calendar year. */
export function formatLastPracticed(lastPracticedAt: string | null | undefined, now: Date = new Date()): string {
  if (!lastPracticedAt) return 'not yet';
  const then = new Date(lastPracticedAt);
  if (Number.isNaN(then.getTime())) return 'not yet';
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days < 14) {
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    return `${days} days ago`;
  }
  return formatDate(lastPracticedAt, now);
}

/**
 * '♩ = 60 · Adagio · settled from your metronome · changes when you play, not here.' The Italian
 * marking comes from `tempoMarking` (`@cadence/shared/metronome.ts`) — the ONE place that number
 * connects to a word, so this never hand-copies a second marking table that could drift from it
 * (CLAUDE.md: a lookup that decides behaviour lives in `@cadence/shared` once). The meter clause
 * only appears when it is not the common 4, same restraint `renderRepertoire`'s own tempo note
 * uses — printing "4 to the bar" on every line would be noise, not information.
 */
export function formatTempoCaption(spec: MetronomeSpec): string {
  const meterClause = spec.meter === DEFAULT_METER ? '' : `${spec.meter} to the bar · `;
  return `♩ = ${spec.bpm} · ${tempoMarking(spec.bpm)} · ${meterClause}settled from your metronome · changes when you play, not here.`;
}

/** '♩ = 60' — the caption line's compact tempo segment (the full sentence lives in the TEMPO
 *  section below; the header just needs enough to place it at a glance). */
export function compactTempo(spec: MetronomeSpec): string {
  return `♩ = ${spec.bpm}`;
}

/**
 * The header's mono caption: standing word · learned month · tempo · session count — each
 * segment present only when there is a fact behind it, joined with the app's usual ' · '. Never
 * invents a segment: a backfilled item with no `learned_at`, an item with no settled tempo, or a
 * caller with no session count simply shortens the line instead of guessing.
 */
export function buildCaption(item: RepertoireItem, sessionCount?: number): string {
  const segments: string[] = [standingWordFor(item.kind, item.status)];
  if (item.learned_at) segments.push(`learned ${monthAbbr(item.learned_at)}`);
  const tempo = settledTempo(item.meta);
  if (tempo) segments.push(compactTempo(tempo));
  if (typeof sessionCount === 'number') {
    segments.push(`${sessionCount} session${sessionCount === 1 ? '' : 's'}`);
  }
  return segments.join(' · ');
}
