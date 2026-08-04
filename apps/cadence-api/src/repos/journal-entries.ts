import { sql } from '../db/sql.ts';
import type { JournalEntry } from '@cadence/shared';

/**
 * The journal store (REQ9 §4.5, migration 0021). Two rules travel with every reader:
 *
 *   • **Words are verbatim.** `body` is stored exactly as written (length-capped at the route,
 *     never rewritten). Nothing here summarizes, scores, or counts for any UI.
 *   • **Secret means secret, entirely** (REQ9 §8). `listForCoach` is the ONLY reader context
 *     packs and Broker parsing may use — it excludes secret rows in SQL, so an entry locked
 *     retroactively drops out of the very next pack build. `listEntries` (the owner's own store
 *     view) returns everything, secrets included, because the key locks against the coach,
 *     not against you.
 */

const ENTRY_COLS = sql`
  entry_id, to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
  bank, prompt, body, secret, mode`;

/** The owner's bookshelf: everything, newest first. */
export async function listEntries(userId: string, limit = 100): Promise<JournalEntry[]> {
  return sql<JournalEntry[]>`
    select ${ENTRY_COLS} from cadence.journal_entries
    where user_id = ${userId}
    order by created_at desc
    limit ${limit}`;
}

/** The coach's reader — secret rows never leave the database on this path. */
export async function listForCoach(userId: string, limit = 20): Promise<JournalEntry[]> {
  return sql<JournalEntry[]>`
    select ${ENTRY_COLS} from cadence.journal_entries
    where user_id = ${userId} and secret = false and mode <> 'paper'
    order by created_at desc
    limit ${limit}`;
}

export async function createEntry(
  userId: string,
  entry: {
    bank: string | null;
    prompt: string | null;
    body: string;
    secret: boolean;
    mode: string;
    sourceOccurrenceId?: string | null;
  },
): Promise<JournalEntry> {
  const [row] = await sql<JournalEntry[]>`
    insert into cadence.journal_entries (user_id, bank, prompt, body, secret, mode, source_occurrence_id)
    values (${userId}, ${entry.bank}, ${entry.prompt}, ${entry.body}, ${entry.secret}, ${entry.mode},
            ${entry.sourceOccurrenceId ?? null})
    returning ${ENTRY_COLS}`;
  if (!row) throw new Error('journal insert returned no row');
  return row;
}

/** The key. Works both directions and retroactively (see listForCoach). */
export async function setEntrySecret(userId: string, entryId: string, secret: boolean): Promise<boolean> {
  const rows = await sql<Array<{ entry_id: string }>>`
    update cadence.journal_entries set secret = ${secret}
    where user_id = ${userId} and entry_id = ${entryId}
    returning entry_id`;
  return rows.length > 0;
}

/** Deletion is the owner's right (export/retention format is a separate open ruling). */
export async function deleteEntry(userId: string, entryId: string): Promise<boolean> {
  const rows = await sql<Array<{ entry_id: string }>>`
    delete from cadence.journal_entries
    where user_id = ${userId} and entry_id = ${entryId}
    returning entry_id`;
  return rows.length > 0;
}
