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
 *  3. **A candidate that cannot be found again is worse than no candidate.** Classical repertoire
 *    collides by design — Suzuki Book 2 alone prints three minuets in G — so every candidate is
 *    checked with `isResolvable` against the person's shelf AND the rest of the batch. An
 *    unresolvable one is kept and marked, never silently dropped and never silently written: the
 *    screen shows the note and the person can qualify it.
 */
import { MAX_SEED_ITEMS, isSeedStatus, qualifierMeta, type SeedStatus } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { listRepertoire, upsertRepertoireItem } from '../repos/repertoire.ts';
import { canonicalLabel, invalidateSessionsFor, isResolvable, samePiece } from './repertoire-practice.ts';
import { normTitle } from './goal-identity.ts';

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

export type ConfirmSeedResult = { ok: true; written: number; labels: string[] } | { ok: false; fault: string };

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

/**
 * Mark the candidates that could never be found again.
 *
 * Two shapes, and `isResolvable` only catches the first:
 *
 *  - A label whose every needle is shared with something else ("Minuet in G Major" beside "Minuet
 *    in G Major, BWV 822"). That row would exist and match nothing.
 *  - Two candidates carrying the SAME label. `isResolvable` reads a same-piece label as an update
 *    of that row, which is right for a re-mention and wrong here: the two would land as one row
 *    on `lower(label)` and the second would overwrite the first's qualifiers.
 */
function markAmbiguity(shelf: Array<{ label: string }>, rows: Omit<SeedCandidate, 'ambiguous'>[]): SeedCandidate[] {
  return rows.map((r, i) => {
    const others = [...shelf, ...rows.filter((_, j) => j !== i).map((o) => ({ label: o.label }))];
    const twin = rows.some((o, j) => j !== i && samePiece(o.label, r.label));
    return { ...r, ambiguous: twin || !isResolvable(others, r.label) };
  });
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
 * Write the rows the person confirmed, and nothing else.
 *
 * The shelf is read once for the whole batch, for the reason `update_repertoire` reads it: each
 * label resolves onto the row that already answers to it, so an accent-variant spelling updates
 * that piece instead of starting a second one beside it. A failed read aborts rather than writing
 * blind — a duplicate row splits a piece's practice history and its settled tempo, permanently.
 */
export async function confirmSeed(
  userId: string,
  rows: SeedRowInput[],
  goalId: string | null = null,
): Promise<ConfirmSeedResult> {
  const seen = new Set<string>();
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
    .filter((r) => r.label.length > 0 && isSeedStatus(r.status))
    // One row per piece: two entries for one label would race the upsert against itself, and
    // `lower(label)` does not fold accents, so they could land as two rows for one piece.
    .filter((r) => {
      const key = normTitle(r.label);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!wanted.length) return { ok: true, written: 0, labels: [] };

  const shelf = await listRepertoire(userId).catch((e): null => {
    console.error('[seed] pre-write shelf read failed:', e);
    return null;
  });
  if (shelf === null) return { ok: false, fault: CONFIRM_FAULT };

  const written: Array<{ label: string; goal_id: string | null }> = [];
  for (let i = 0; i < wanted.length; i += WRITE_CONCURRENCY) {
    const batch = await Promise.all(
      wanted.slice(i, i + WRITE_CONCURRENCY).map(async (r) => {
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

  return { ok: true, written: written.length, labels: written.map((w) => w.label) };
}
