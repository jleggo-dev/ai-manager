/**
 * Seeding a collection — "Suzuki Piano Book 2" becomes the pieces it holds, in the book's order,
 * and nothing is written until the person says which ones are theirs.
 *
 * Two halves, deliberately separate:
 *
 *  - `expandCollection` READS. It runs the `expand-collection` job through AI Admin and hands back
 *    candidates. It writes nothing, so a wrong answer costs a tap to correct rather than sixty
 *    rows to undo.
 *  - `confirmSeed` WRITES, and only what came back from the screen.
 *
 * The rules that are easy to get wrong and silent when you do:
 *
 *  1. **A broken read is not an empty book.** A job that throws, output that will not parse, a
 *    shelf read that fails — each returns a fault the caller can tell apart from "I do not know
 *    that collection". tool-response.ts exists because collapsing those two put a confident lie in
 *    the coach's mouth for weeks.
 *  2. **A seed writes `known`, `working` or `queued` and nothing else** (SEED_STATUSES). `retired`
 *    would file pieces as finished that nobody finished; the `learned` verb would stamp sixty
 *    crossings with today's date and hand the recap "you learned sixty pieces this week".
 *  3. **A row that cannot be found again is worse than no row.** Classical repertoire collides by
 *    design — Suzuki Book 2 alone prints three minuets in G — so every label is checked with
 *    `isResolvable` against the person's shelf AND the rest of the batch. `expandCollection` MARKS
 *    such a candidate so the screen can say so; `confirmSeed` REFUSES it and names it back
 *    (supervisor ruling 2026-09-02). That is `update_repertoire`'s own gate, applied here rather
 *    than a looser one: a row nothing can resolve reads as a record and behaves as a hole, and the
 *    only useful answer is to say which label needs a fuller name.
 */
import { MAX_SEED_ITEMS, isSeedStatus, qualifierMeta, type SeedStatus } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { listRepertoire, upsertRepertoireItem } from '../repos/repertoire.ts';
import {
  canonicalLabel,
  invalidateSessionsFor,
  isResolvable,
  itemNamedIn,
  matchHay,
  samePiece,
} from './repertoire-practice.ts';

/** One piece the job proposed, after the app has normalized it. Nothing here is stored yet. */
export interface SeedCandidate {
  label: string;
  composer: string | null;
  collection: string | null;
  catalogue: string | null;
  /** 1-based position in the collection's own order — dense, assigned here, never by the model. */
  rank: number;
  /** True when this label cannot be told from another candidate's or from one already on file. */
  ambiguous: boolean;
}

export type ExpandCollectionResult =
  { ok: true; collection: string; candidates: SeedCandidate[] } | { ok: false; fault: string };

/** One row the person confirmed. `status` is re-checked here; the route's schema is not the guard. */
export interface SeedRowInput {
  label: string;
  composer?: string | null;
  collection?: string | null;
  catalogue?: string | null;
  rank?: number | null;
  status: SeedStatus;
}

/** A row the seed would not write, and the words that say what to do about it. */
export interface RefusedSeedRow {
  label: string;
  reason: string;
}

export type ConfirmSeedResult =
  { ok: true; written: number; labels: string[]; refused: RefusedSeedRow[] } | { ok: false; fault: string };

/* ── Faults ──────────────────────────────────────────────────────────────────────────────────
   tool-response.ts's stance, in words meant for a person rather than for the coach: say it was
   us, say nothing was saved, and never phrase it as a count. A screen that renders "0 pieces
   found" over a crash teaches the person their book is not in there. */
const EXPAND_FAULT =
  'I could not look that up just now — a fault on our side, not an empty book. Nothing was saved. Try again in a moment.';
const CONFIRM_FAULT =
  'I could not read what is already on your shelf just now — a fault on our side, not an empty record. Nothing was saved. Try again in a moment.';

/** Longest any one field may be. Matches `qualifierString`'s own bound in @cadence/shared. */
const MAX_TEXT = 120;

/**
 * Anything URL-shaped, stripped before a value is shown or stored.
 *
 * A model asked for a book's contents sometimes cites where it read them. A link in a piece's
 * title is not part of the title, it survives into every render and every prompt, and it is the
 * one shape in model output that can carry somewhere to go. Cheaper to remove than to reason about.
 */
const URLISH = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|co|edu|gov|info|app|dev|me|ly)\b\S*/gi;

/** Trim, de-link, collapse and bound one string. '' for anything that is not usable text. */
function scrub(raw: unknown, max = MAX_TEXT): string {
  if (typeof raw !== 'string') return '';
  return (
    raw
      .normalize('NFC')
      .replace(URLISH, ' ')
      // A stripped link usually takes a bracket's closer with it; leave no orphan behind.
      .replace(/\(\s*\)|\[\s*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[([{\-–—,;:|]+$/, '')
      .replace(/^[)\]}\-–—,;:|]+/, '')
      .trim()
      .slice(0, max)
      .trim()
  );
}

const orNull = (raw: unknown): string | null => scrub(raw) || null;

interface RawItem {
  label?: unknown;
  composer?: unknown;
  collection?: unknown;
  catalogue?: unknown;
}

/**
 * Model output → candidates. De-linked, empty labels dropped, cut to the cap, and ranked 1..n in
 * the order the model returned — the prompt asks for the collection's own order, and renumbering
 * here means a model that skipped or repeated a number cannot make the screen's list jump.
 *
 * The cut comes AFTER the drops, so sixty means sixty usable rows: cutting first would let a
 * couple of junk entries silently cost the person the last two pieces in their book.
 */
function normalizeItems(raw: unknown[]): Omit<SeedCandidate, 'ambiguous'>[] {
  return raw
    .map((entry) => {
      const item = (entry ?? {}) as RawItem;
      return {
        label: scrub(item.label),
        composer: orNull(item.composer),
        collection: orNull(item.collection),
        catalogue: orNull(item.catalogue),
      };
    })
    .filter((c) => c.label.length > 0)
    .slice(0, MAX_SEED_ITEMS)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

/* ── One collision rule, used twice ──────────────────────────────────────────────────────────
   `expandCollection` marks with it and `confirmSeed` refuses with it, so the note the screen shows
   and the row the server rejects can never disagree about which label is the problem. */

/** Everything the row at `index` has to be tellable apart FROM: the shelf, plus its own batch. */
const rivals = (shelf: Array<{ label: string }>, rows: Array<{ label: string }>, index: number) => [
  ...shelf,
  ...rows.filter((_, j) => j !== index).map((o) => ({ label: o.label })),
];

/**
 * Would this row be impossible to find again once it is saved?
 *
 * Two shapes, and `isResolvable` only catches the first:
 *
 *  - A label whose every needle is shared with something else ("Minuet in G Major" beside "Minuet
 *    in G Major, BWV 822"). That row would exist and match nothing.
 *  - Two rows in one batch carrying the SAME label. `isResolvable` reads a same-piece label as an
 *    update of that row, which is right for a re-mention and wrong here: the two would land as one
 *    row on `lower(label)` and the second would overwrite the first's qualifiers.
 */
function collides(shelf: Array<{ label: string }>, rows: Array<{ label: string }>, index: number): boolean {
  const label = rows[index]!.label;
  return twinInBatch(rows, index) || !isResolvable(rivals(shelf, rows, index), label);
}

const twinInBatch = (rows: Array<{ label: string }>, index: number): boolean =>
  rows.some((o, j) => j !== index && samePiece(o.label, rows[index]!.label));

/**
 * Why a row was refused, in words that say what to change — `update_repertoire`'s own shape:
 * name the pieces it collides with, because "add a qualifier" is only actionable once you know
 * which piece you are being told apart from.
 */
function refusalReason(shelf: Array<{ label: string }>, rows: Array<{ label: string }>, index: number): string {
  const label = rows[index]!.label;
  if (twinInBatch(rows, index)) {
    return 'two of these carry the same name — give one of them the composer or the catalogue number so each names one piece';
  }
  const clash = shelf.filter((i) => !samePiece(i.label, label) && itemNamedIn(i.label, matchHay([label])));
  const named = clash.length ? clash.map((c) => `"${c.label}"`).join(' and ') : 'a piece you already have';
  return `already the title of ${named} — add the composer, the catalogue number, or the collection so it names one piece`;
}

/** The candidates the screen must warn about. Same rule the confirm refuses on. */
function markAmbiguity(shelf: Array<{ label: string }>, rows: Omit<SeedCandidate, 'ambiguous'>[]): SeedCandidate[] {
  return rows.map((r, i) => ({ ...r, ambiguous: collides(shelf, rows, i) }));
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Expand a named collection into candidates. Writes nothing.
 *
 * The shelf is read FIRST: the ambiguity check needs it, and a database that cannot answer should
 * not cost a model call whose answer we could not check anyway.
 */
export async function expandCollection(userId: string, text: string): Promise<ExpandCollectionResult> {
  const collection = scrub(text);
  if (!collection) return { ok: false, fault: EXPAND_FAULT };

  const shelf = await listRepertoire(userId).catch((e): null => {
    console.error('[seed] shelf read failed:', e);
    return null;
  });
  if (shelf === null) return { ok: false, fault: EXPAND_FAULT };

  const answer = await runJobBySlug(userId, 'expand-collection', { collection }).catch((e): null => {
    console.error('[seed] expand-collection failed:', e);
    return null;
  });
  if (!answer) return { ok: false, fault: EXPAND_FAULT };

  const parsed = parseJson(answer.formatted ?? answer.raw ?? '');
  // No items ARRAY is a fault; an EMPTY array is an answer ("I do not know that collection").
  if (!parsed || !Array.isArray(parsed.items)) {
    console.error('[seed] expand-collection returned no items array');
    return { ok: false, fault: EXPAND_FAULT };
  }

  return { ok: true, collection, candidates: markAmbiguity(shelf, normalizeItems(parsed.items)) };
}

/** How many upserts run at once. Each is a round trip; sixty at once is a pool exhaustion. */
const WRITE_CONCURRENCY = 8;

/**
 * Write the rows the person confirmed — minus any the shelf could never tell apart.
 *
 * The shelf is read once for the whole batch, for the reason `update_repertoire` reads it: each
 * label resolves onto the row that already answers to it, so an accent-variant spelling updates
 * that piece instead of starting a second one beside it. A failed read aborts rather than writing
 * blind — a duplicate row splits a piece's practice history and its settled tempo, permanently.
 *
 * Refusals are REPORTED, not dropped. Every refused row comes back with its label and the reason,
 * so the screen can say which name needs qualifying instead of the person finding out later that
 * two of their pieces became one.
 */
export async function confirmSeed(
  userId: string,
  rows: SeedRowInput[],
  goalId: string | null = null,
): Promise<ConfirmSeedResult> {
  const wanted = rows
    .map((r) => ({
      label: scrub(r.label),
      composer: orNull(r.composer),
      collection: orNull(r.collection),
      catalogue: orNull(r.catalogue),
      rank: typeof r.rank === 'number' && Number.isInteger(r.rank) && r.rank >= 1 ? r.rank : undefined,
      status: r.status,
    }))
    // The three standings and no others, checked here rather than trusted from the wire.
    .filter((r) => r.label.length > 0 && isSeedStatus(r.status));
  if (!wanted.length) return { ok: true, written: 0, labels: [], refused: [] };

  const shelf = await listRepertoire(userId).catch((e): null => {
    console.error('[seed] pre-write shelf read failed:', e);
    return null;
  });
  if (shelf === null) return { ok: false, fault: CONFIRM_FAULT };

  // Judged against the WHOLE batch, never against the survivors: refusing the first of two twins
  // must not make the second one look unique.
  const refused: RefusedSeedRow[] = [];
  const writable = wanted.filter((r, i) => {
    if (!collides(shelf, wanted, i)) return true;
    refused.push({ label: r.label, reason: refusalReason(shelf, wanted, i) });
    return false;
  });

  const written: Array<{ label: string; goal_id: string | null }> = [];
  for (let i = 0; i < writable.length; i += WRITE_CONCURRENCY) {
    const batch = await Promise.all(
      writable.slice(i, i + WRITE_CONCURRENCY).map(async (r) => {
        const { item } = await upsertRepertoireItem(userId, {
          label: canonicalLabel(shelf, r.label),
          status: r.status,
          goal_id: goalId,
          meta: qualifierMeta({
            composer: r.composer ?? undefined,
            collection: r.collection ?? undefined,
            catalogue: r.catalogue ?? undefined,
            rank: r.rank,
          }),
          // Never. A seed is a backfill, and only a crossing we watched happen is stamped.
          markLearned: false,
        });
        return item;
      }),
    );
    written.push(...batch);
  }

  // The rotation reads cached prescriptions; a shelf this size makes every one of them stale.
  await invalidateSessionsFor(userId, written).catch(() => undefined);

  return { ok: true, written: written.length, labels: written.map((w) => w.label), refused };
}
