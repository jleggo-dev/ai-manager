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

/**
 * The P3 reuse read (rebuilt 2026-08-04 — its ancestor was deleted as dead code the same day; the
 * lesson stood: the READ was never the hard part). A pack is reusable only when built after
 * `greatest(users.pack_touched_at, users.updated_at)`:
 *
 *   - `pack_touched_at` is moved by DATABASE TRIGGERS on every dossier table (migration 0022) —
 *     the listForCoach move: one missed app-side invalidate call would be "making you repeat
 *     yourself", so no app code is trusted to remember.
 *   - `users.updated_at` covers the users row itself (name/baseline/macro writes bump it).
 *
 * Intent is matched via sections->>'intent' because the intent framing is baked into `rendered`
 * — an ongoing pack reused for a recap session would open with the wrong framing. Packs from
 * before intent was stored simply never match and rebuild once.
 */
export async function getFreshContextPack(
  userId: string,
  topic: string | null,
  intent: string,
): Promise<{ id: string; rendered: string; provenance: ProvenanceEntry[]; builtAt: string; expiresAt: string } | null> {
  try {
    const rows = await sql`
      select cp.id, cp.rendered, cp.provenance,
             cp.built_at::text as built_at, cp.expires_at::text as expires_at
      from cadence.context_pack cp
      join cadence.users u on u.id = cp.user_id
      where cp.user_id = ${userId}
        and cp.topic is not distinct from ${topic}
        and cp.sections->>'intent' = ${intent}
        and cp.expires_at > now()
        and cp.built_at > greatest(u.pack_touched_at, u.updated_at)
      order by cp.built_at desc
      limit 1`;
    const r = rows[0] as
      { id: string; rendered: string; provenance: ProvenanceEntry[]; built_at: string; expires_at: string } | undefined;
    return r
      ? { id: r.id, rendered: r.rendered, provenance: r.provenance, builtAt: r.built_at, expiresAt: r.expires_at }
      : null;
  } catch (e) {
    // Fail toward a rebuild, never toward an error: reuse is an optimisation, not a dependency.
    console.error('[getFreshContextPack]', e);
    return null;
  }
}
