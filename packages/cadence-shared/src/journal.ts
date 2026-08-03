/* ════════════════════════════════════════════════════════════════
   The Journal — banks, entry shape, and the two rules (REQ9 §4.5)
   ════════════════════════════════════════════════════════════════ */

/**
 * The Mind pillar's first module: writing (or speaking, or a paper note) into a store you can
 * reread. Two rules organize everything (journal-brief):
 *
 *   • **Words in, words back — never analysis.** The store shows your sentences as you wrote
 *     them. No sentiment, no themes, no counts, no streaks, anywhere in the module. (The Scribe
 *     may extract coaching context behind the scenes — from non-secret entries only — but that
 *     is invisible here.)
 *   • **Secret means secret, entirely.** The key locks an entry against the coach, not against
 *     you: a secret entry is excluded from context packs AND from all parsing (REQ9 §8),
 *     retroactively. Nothing about it is scanned, summarized, or asked about.
 *
 * The banks are Design's copy (Journal v2, settled): each bank is ONE question with several
 * reviewed phrasings — the pool is what keeps a daily practice from going stale (their option A),
 * and the coach may choose which phrasing today's chip shows, but may never write new content.
 */

export type JournalBankId =
  'three_good_things' | 'park_a_worry' | 'a_win' | 'savor_it' | 'smallest_next_thing' | 'whats_actually_true';

export type JournalMode = 'typed' | 'spoken' | 'paper';

export interface JournalBank {
  id: JournalBankId;
  /** The chip label, uppercase-styled by the UI (Design: "THREE GOOD THINGS"). */
  label: string;
  /** Reviewed phrasings of the bank's one question. Index 0 is Design's primary line. */
  phrasings: readonly string[];
  /** Gratitude-family banks carry the share-out affordance (trigger = the kept prompt, never
   *  content inspection — the correction Design made in review). */
  gratitude?: boolean;
}

export const JOURNAL_BANKS: readonly JournalBank[] = [
  {
    id: 'three_good_things',
    label: 'Three good things',
    gratitude: true,
    phrasings: [
      'What were three good things about today? Small ones count.',
      'What made today easier than it could have been?',
      'Who helped, even a little?',
      'What would you have missed about today if you had slept through it?',
      'Name three things that went right — however ordinary.',
    ],
  },
  {
    id: 'park_a_worry',
    label: 'Park a worry',
    phrasings: [
      "What's circling? Put it down here — it'll keep until tomorrow.",
      'What keeps coming back tonight? Set it down in words.',
      "Write the worry once, plainly. It doesn't need you until morning.",
      "What's riding along with you today that you could park here?",
    ],
  },
  {
    id: 'a_win',
    label: 'A win',
    phrasings: [
      'What went right today — and what did you do to make it go right?',
      'Name one thing you handled today.',
      'What worked today that might work again?',
      'Where did today go better than you expected — and why?',
    ],
  },
  {
    id: 'savor_it',
    label: 'Savor it',
    gratitude: true,
    phrasings: [
      'One moment worth keeping — add the photo, give it a line.',
      'What would you like to remember about today?',
      'Catch one moment before it slips — a line is enough.',
      'What did you almost not notice today?',
    ],
  },
  {
    id: 'smallest_next_thing',
    label: 'Smallest next thing',
    phrasings: [
      "What's the smallest next thing you could do? Naming it is enough.",
      'What would make tomorrow one notch easier?',
      'One small thing, for future you. What is it?',
      "What's the next right thing — the small version?",
    ],
  },
  {
    id: 'whats_actually_true',
    label: "What's actually true",
    phrasings: [
      "Take the loudest thought you've had today. What's actually true about it?",
      'What would you tell a friend who told you this thought?',
      'Write the thought down, then write what the evidence says.',
      "What's the kinder reading of today that is still honest?",
    ],
  },
];

const BY_ID = new Map<string, JournalBank>(JOURNAL_BANKS.map((b) => [b.id, b]));

export function isJournalBankId(v: string | null | undefined): v is JournalBankId {
  return typeof v === 'string' && BY_ID.has(v);
}

export function journalBank(id: string | null | undefined): JournalBank | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function isJournalMode(v: string | null | undefined): v is JournalMode {
  return v === 'typed' || v === 'spoken' || v === 'paper';
}

/**
 * Today's phrasing for a bank — deterministic rotation by calendar day, so the chip is stable all
 * day, changes tomorrow, and needs no stored state. (When the coach later orders/chooses, that
 * choice replaces this default; the pool itself never changes at runtime.)
 */
export function todaysPhrasing(bank: JournalBank, dateIso: string): string {
  const day = Math.floor(new Date(`${dateIso}T00:00:00Z`).getTime() / 86_400_000);
  const idx = ((day % bank.phrasings.length) + bank.phrasings.length) % bank.phrasings.length;
  return bank.phrasings[idx] ?? bank.phrasings[0] ?? '';
}

/** May this entry carry the share-out affordance? Trigger is the KEPT PROMPT's bank — never
 *  content inspection (which would break on secrets) — and never on a secret entry. */
export function isShareableGratitude(bank: string | null | undefined, secret: boolean): boolean {
  return !secret && !!journalBank(bank)?.gratitude;
}

/** One entry, as stored and as listed. `body` is verbatim — we keep sentences, we don't improve
 *  them; the only transformation ever applied is a length cap at write time. */
export interface JournalEntry {
  entry_id: string;
  created_at: string;
  bank: JournalBankId | null;
  prompt: string | null;
  body: string;
  secret: boolean;
  mode: JournalMode;
}

/** The store list's preview line — the entry's own first line, never a summary. */
export function journalPreview(entry: Pick<JournalEntry, 'body' | 'mode'>, max = 90): string {
  if (entry.mode === 'paper') return 'In your physical journal';
  const first = entry.body.split('\n').find((l) => l.trim()) ?? '';
  return first.length <= max ? first : `${first.slice(0, max).trimEnd()}…`;
}

/** The first-use disclosure, said once, verbatim (REQ9 §4.5 — the owner-approved line). */
export const JOURNAL_DISCLOSURE =
  "I keep your notes so I can know you better — mark anything secret and I won't use it.";

/** The line under the share affordance (Design's copy — the practice's own framing). */
export const SHARE_FRAMING = 'Send it, read it to them, or keep it — writing it already did most of the work.';
