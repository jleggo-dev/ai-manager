import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEV_CHILD_TABLES } from './dev-reset.ts';

/**
 * The guard on "start over erases everything".
 *
 * `resetUserData` deletes per-user rows table by table (it keeps the `users` row on purpose), so
 * its coverage is a hand-written list sitting a long way from the `create table` statements that
 * define what needs covering. That drifts, silently, and nothing fails when it does: by 2026-08-12
 * seven tables had accumulated outside the list — including `journal_entries` and `health_digests`,
 * so a start-over left someone's writing and their Apple Health history on the server while telling
 * them everything was gone.
 *
 * So the schema is read, not remembered. This parses the migrations rather than querying Postgres
 * deliberately: the DB-backed suites skip entirely in CI (no `CADENCE_*` secrets — see PLAN.md's
 * Postgres backlog), and a guard that does not run where it matters is not a guard. The migrations
 * are in the repo, so this runs everywhere, on every PR, including the one that adds the next table.
 */

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../migrations/cadence');

/** `create table if not exists cadence.<name> ( ... );` → [name, body]. */
function createdTables(sqlText: string): [string, string][] {
  const out: [string, string][] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?cadence\.(\w+)\s*\(([\s\S]*?)\n\);/gi;
  for (const m of sqlText.matchAll(re)) out.push([m[1]!, m[2]!]);
  return out;
}

/** Every cadence table whose rows belong to one user, from the migrations themselves. */
function perUserTables(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    for (const [name, body] of createdTables(readFileSync(path.join(MIGRATIONS, file), 'utf8'))) {
      if (/^\s*user_id\s/m.test(body)) found.add(name);
    }
  }
  return [...found].sort();
}

describe('DEV_CHILD_TABLES', () => {
  // A parser that silently matches nothing would make every assertion below vacuously pass, which
  // is the one way this guard could fail without anyone noticing.
  it('actually reads the migrations', () => {
    const tables = perUserTables();
    expect(tables.length).toBeGreaterThan(15);
    expect(tables).toContain('goals');
  });

  it('covers every table in the schema keyed by user_id', () => {
    const missing = perUserTables().filter((t) => !(DEV_CHILD_TABLES as readonly string[]).includes(t));
    // Named in the failure so the fix is obvious: add them to DEV_CHILD_TABLES in dev-reset.ts.
    expect(missing, `tables with a user_id column that "start over" would NOT delete: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('names no table the schema does not have', () => {
    const known = new Set(perUserTables());
    const stale = DEV_CHILD_TABLES.filter((t) => !known.has(t));
    expect(stale, `listed for deletion but not in the migrations: ${stale.join(', ')}`).toEqual([]);
  });

  it('does not try to delete the users row it is meant to keep', () => {
    expect(DEV_CHILD_TABLES).not.toContain('users');
  });
});
