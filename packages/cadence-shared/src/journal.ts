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
  | 'three_good_things'
  | 'park_a_worry'
  | 'a_win'
  | 'savor_it'
  | 'smallest_next_thing'
  | 'whats_actually_true'
  | 'free_write'
  | 'practice_log'
  | 'what_you_learned'
  | 'explain_it_back'
  | 'sit_with_a_line'
  | 'day_reviewed';

export type JournalMode = 'typed' | 'spoken' | 'paper';

/**
 * What KIND of practice a bank serves. The journal is a writing tool, not a feelings tool (REQ9
 * §4.5) — a novelist, a student and someone with a devotional practice are all doing the same
 * thing with it, and shipping only reflection banks quietly told three of those four they were in
 * the wrong app.
 */
export type JournalFamily = 'reflection' | 'craft' | 'study' | 'devotion';

export interface JournalBank {
  id: JournalBankId;
  /** The chip label, uppercase-styled by the UI (Design: "THREE GOOD THINGS"). */
  label: string;
  /** Reviewed phrasings of the bank's one question. Index 0 is Design's primary line. */
  phrasings: readonly string[];
  /** Gratitude-family banks carry the share-out affordance (trigger = the kept prompt, never
   *  content inspection — the correction Design made in review). */
  gratitude?: boolean;
  /** Absent means `reflection` — the six original banks predate the split. */
  family?: JournalFamily;
}

/** A bank's practice family, with the documented default applied. */
export function bankFamily(bank: JournalBank): JournalFamily {
  return bank.family ?? 'reflection';
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

  // ── craft ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'free_write',
    label: 'Free-write',
    family: 'craft',
    phrasings: [
      // Design's primary line (Journal v2 §1b) — and deliberately duration-free, because the same
      // question serves an untimed entry and a timed one whose length the coach or reader chooses.
      "Write continuously — whatever comes. Don't stop, don't edit; anything counts.",
      'Write without stopping — no fixing as you go.',
      'Start in the middle of a scene and write until it turns.',
      'Describe a place you know well to someone who has never been there.',
      "Write the conversation you didn't get to have.",
      'Take the last thing that surprised you and make it fiction.',
    ],
  },
  {
    id: 'practice_log',
    label: 'What you made',
    family: 'craft',
    phrasings: [
      'What did you work on, and where did you leave it?',
      "What's the first thing you'll do when you sit down again?",
      'What worked today that you want to keep?',
      'What were you stuck on, and what did you try?',
      'How long did you actually work, and what pulled you away?',
    ],
  },

  // ── study ──────────────────────────────────────────────────────────────────────────────────
  {
    id: 'what_you_learned',
    label: 'What you learned',
    family: 'study',
    phrasings: [
      "What's one thing you understand today that you didn't yesterday?",
      'What did you get wrong, and what was the misunderstanding underneath it?',
      "Which part still doesn't fit together?",
      'What would you need to look up to go one step further?',
      "Write today's idea in a sentence a twelve-year-old would follow.",
    ],
  },
  {
    id: 'explain_it_back',
    label: 'Explain it back',
    family: 'study',
    phrasings: [
      "Explain today's idea in your own words, without looking at your notes.",
      'Teach it to someone who knows nothing about it. Where do you stumble?',
      "What's the simplest example that shows why this matters?",
      "Where does your explanation go vague? That's the part you don't have yet.",
      'What question would catch you out if someone asked it right now?',
    ],
  },

  // ── devotion ───────────────────────────────────────────────────────────────────────────────
  // Shaped by lectio divina and the examen, written so they work for someone with a religious
  // practice AND someone without one — REQ9 §1: "without the religious context (unless you were
  // using it for religious reasons)". Nothing here names a tradition or assumes belief.
  {
    id: 'sit_with_a_line',
    label: 'Sit with a line',
    family: 'devotion',
    phrasings: [
      'Take one line from what you read. Which word stays with you?',
      'Read it again slowly. What does it ask of you today?',
      'What in it did you resist?',
      'Write the line out, then write what it means to you now.',
      'What would today look like if you took it seriously?',
    ],
  },
  {
    id: 'day_reviewed',
    label: 'The day, looked back over',
    family: 'devotion',
    phrasings: [
      'Walk back through the day. Where were you most yourself?',
      'What are you grateful for, and what are you sorry for?',
      'Where did you turn toward something good, and where away from it?',
      'Which moment would you live again, and what would you do differently?',
      'What do you want to carry into tomorrow?',
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
