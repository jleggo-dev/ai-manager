/* ════════════════════════════════════════════════════════════════
   Journal export — the words back out, in a format nothing owns
   ════════════════════════════════════════════════════════════════ */

import type { JournalEntry } from './journal.ts';

/**
 * Markdown, because the promise is "never makes you start over" and a journal you can't take with
 * you is a journal someone else owns (owner ruling 2026-08-04: entries live as long as the user
 * wants, are exportable, and can be deleted).
 *
 * Three decisions worth stating, because each is a place this could quietly betray someone:
 *
 *   • **Secrets are included.** The key locks entries against the COACH, never against the person
 *     who wrote them — withholding someone's own words from their own export would be a different
 *     product. They're labelled so nobody is surprised by what's in the file, and the caller is
 *     expected to say so before handing it over.
 *   • **Chronological, oldest first.** The shelf reads newest-first because you're looking for
 *     something recent; a document reads forward, like the notebook it stands in for.
 *   • **Nothing is interpreted.** No themes, no counts, no sentiment, no "you wrote most on
 *     Tuesdays" — the same rule the coach follows. Words, dates, and the question that prompted
 *     them, and that is all.
 */

/** Paper entries have no words to export — we never held them. Say so rather than showing a gap. */
const PAPER_NOTE = '_Written on paper._';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Spelled out rather than delegated to `toLocaleDateString`, which varies with the host's ICU data
 * — an export someone keeps for years should not change shape because it was generated on a
 * different machine, and a test asserting it should not be at the mercy of a Node upgrade.
 */
function heading(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Undated';
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Escape the few sequences that would otherwise restructure someone's document. A line of theirs
 * beginning "# " is prose, not a heading, and a run of dashes is not a horizontal rule — the export
 * must render as what they wrote, not as markup they didn't intend.
 */
function fence(body: string): string {
  return body
    .split('\n')
    .map((line) => (/^\s*(#{1,6}\s|---+\s*$|===+\s*$|>\s)/.test(line) ? `\\${line.trimStart()}` : line))
    .join('\n');
}

export interface JournalExportOptions {
  /** Stamped in the header so a file found later explains itself. Pass the caller's clock. */
  exportedAt?: string;
}

export function journalToMarkdown(entries: readonly JournalEntry[], options: JournalExportOptions = {}): string {
  const ordered = [...entries].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const stamp = options.exportedAt ? heading(options.exportedAt) : null;
  const secrets = ordered.filter((e) => e.secret).length;

  const out: string[] = ['# Your journal', ''];
  const counted = `${ordered.length} ${ordered.length === 1 ? 'entry' : 'entries'}`;
  const secretNote = secrets > 0 ? `, ${secrets} marked secret` : '';
  out.push(stamp ? `${counted}${secretNote} · exported ${stamp}` : `${counted}${secretNote}`, '');

  if (ordered.length === 0) {
    // An empty journal is a real state, not an error — say something true and stop.
    out.push('Nothing written yet.', '');
    return out.join('\n');
  }

  for (const e of ordered) {
    out.push('---', '');
    out.push(`## ${heading(String(e.created_at))}${e.secret ? ' · secret' : ''}`, '');
    if (e.prompt) out.push(`*${e.prompt}*`, '');
    const body = String(e.body ?? '').trim();
    out.push(body ? fence(body) : PAPER_NOTE, '');
  }
  return out.join('\n');
}

/** A stable, sortable filename — "cadence-journal-2026-08-04.md". */
export function journalExportFilename(isoDate: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(isoDate)?.[0] ?? 'export';
  return `cadence-journal-${day}.md`;
}
