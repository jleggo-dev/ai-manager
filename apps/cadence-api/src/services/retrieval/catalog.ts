/**
 * Catalog / metadata doc (MEMORY-ARCHITECTURE.md §4.2) — LLM-consumable description of
 * what the Broker can call + how much data exists. The function list drives P2 selection;
 * the per-domain stats let the Broker judge volume/recency (and, later, staleness).
 */
import { sql } from '../../db/sql.ts';
import { RETRIEVAL_FUNCTIONS } from './registry.ts';

export interface DomainStat {
  domain: string;
  rows: number;
  latest: string | null;
}

async function stat(domain: string, table: 'goals' | 'equipment' | 'occurrences', userId: string): Promise<DomainStat> {
  try {
    let rows;
    if (table === 'goals') rows = await sql`select count(*)::int n, max(created_at) latest from cadence.goals where user_id = ${userId}`;
    else if (table === 'equipment') rows = await sql`select count(*)::int n, max(created_at) latest from cadence.equipment where user_id = ${userId}`;
    else rows = await sql`select count(*)::int n, max(created_at) latest from cadence.occurrences where user_id = ${userId}`;
    const r = rows[0] as { n: number; latest: string | null } | undefined;
    return { domain, rows: r?.n ?? 0, latest: r?.latest ?? null };
  } catch {
    return { domain, rows: 0, latest: null };
  }
}

export async function getDomainStats(userId: string): Promise<DomainStat[]> {
  return Promise.all([stat('goals', 'goals', userId), stat('equipment', 'equipment', userId), stat('occurrences', 'occurrences', userId)]);
}

/** Render the catalog as a compact doc the Broker can reason over (P2). */
export async function renderCatalogDoc(userId: string): Promise<string> {
  const stats = await getDomainStats(userId);
  const day = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : '—');
  return [
    `## Domains (as of ${new Date().toISOString().slice(0, 10)})`,
    ...stats.map((s) => `${s.domain}: ${s.rows} rows · latest ${day(s.latest)}`),
    '## Retrieval functions',
    ...Object.values(RETRIEVAL_FUNCTIONS).map((f) => `- ${f.name} [${f.domains.join(',')}]: ${f.description}`),
  ].join('\n');
}
