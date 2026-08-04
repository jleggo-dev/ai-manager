import type { JournalEntry } from '@cadence/shared';
import { BASE, headers } from './http.ts';

/**
 * The journal store client. Words travel verbatim both ways — the only failure posture a journal
 * can afford is loud-and-local (the page keeps the draft), never a silent drop.
 */

export async function listJournal(): Promise<JournalEntry[]> {
  const res = await fetch(`${BASE}/journal`, { headers: headers() });
  if (!res.ok) throw new Error('failed to load journal');
  const body = (await res.json()) as { entries?: JournalEntry[] };
  return Array.isArray(body.entries) ? body.entries : [];
}

export async function keepJournalEntry(entry: {
  bank?: string | null;
  prompt?: string | null;
  body: string;
  secret?: boolean;
  mode?: 'typed' | 'spoken' | 'paper';
}): Promise<JournalEntry> {
  const res = await fetch(`${BASE}/journal`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!res.ok) throw new Error('failed to keep the entry');
  return ((await res.json()) as { entry: JournalEntry }).entry;
}

export async function setJournalSecret(entryId: string, secret: boolean): Promise<boolean> {
  const res = await fetch(`${BASE}/journal/${entryId}/secret`, {
    method: 'PATCH',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret }),
  });
  return res.ok;
}

/**
 * Download the whole journal as Markdown. Fetched with the auth header rather than opening the URL
 * directly — a plain link carries no token, and Cadence never puts one in a query string.
 *
 * Returns the blob and the server's filename so the caller can hand it to the OS. Secrets are
 * included (the key locks entries against the coach, not against you), so anything calling this
 * must say so before it runs.
 */
export async function exportJournal(): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${BASE}/journal/export`, { headers: headers() });
  if (!res.ok) throw new Error('failed to export the journal');
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'cadence-journal.md';
  return { blob: await res.blob(), filename };
}
