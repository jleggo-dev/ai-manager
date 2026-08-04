import { sql, json } from '../db/sql.ts';

export interface ProvenanceEntry {
  fn: string;
  params: Record<string, unknown>;
  rows: number;
  at: string;
}

export interface InsertContextPack {
  userId: string;
  topic: string | null;
  sections: Record<string, string>;
  rendered: string;
  provenance: ProvenanceEntry[];
  tokenEstimate: number;
  expiresAt: string;
  version?: number;
  status?: string;
}

/** Persist a built context pack (best-effort — a failure must not block the session). */
export async function insertContextPack(p: InsertContextPack): Promise<string | null> {
  try {
    const rows = await sql`
      insert into cadence.context_pack
        (user_id, topic, sections, rendered, provenance, token_estimate, expires_at, version, status)
      values
        (${p.userId}, ${p.topic}, ${json(p.sections)}, ${p.rendered}, ${json(p.provenance)},
         ${p.tokenEstimate}, ${p.expiresAt}, ${p.version ?? 1}, ${p.status ?? 'fresh'})
      returning id`;
    return (rows[0] as { id?: string } | undefined)?.id ?? null;
  } catch (e) {
    console.error('[insertContextPack]', e);
    return null;
  }
}

/** Latest non-expired pack for (user, topic) — for future reuse (P3). */
/*
 * DELETED 2026-08-04: `getFreshContextPack` — a reader that returned the newest unexpired pack so
 * a turn could skip rebuilding one. It was written, never called by anything, and read from the
 * outside like a shipped optimisation; that is how PLAN §12 came to list pack-reuse as further
 * along than it was.
 *
 * Reuse is still worth having — building a pack costs TWO Scribe calls (select, then summarize)
 * before the coach starts replying, on every single turn. But the read was never the hard part.
 * The hard part is knowing when a pack has gone stale, and getting that wrong breaks the one
 * promise the product makes loudest: a coach working from a cached briefing would forget what you
 * told it a minute ago, which is precisely "making you repeat yourself".
 *
 * So whoever picks this up: build the invalidation rule FIRST (any write to goals/plan/
 * occurrences/journal invalidates that user's pack), and the six-line read after. Rewriting the
 * query is trivial; the rule is the feature. `insertContextPack` stays — the table still earns
 * its keep as the audit trail behind the dev X-ray.
 */
