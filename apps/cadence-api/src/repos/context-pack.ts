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
export async function getFreshContextPack(userId: string, topic: string | null): Promise<{ rendered: string } | null> {
  const rows = await sql`
    select rendered from cadence.context_pack
    where user_id = ${userId} and topic is not distinct from ${topic} and expires_at > now()
    order by built_at desc limit 1`;
  return (rows[0] as { rendered: string } | undefined) ?? null;
}
