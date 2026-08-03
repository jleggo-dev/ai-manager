import { describe, expect, it } from 'vitest';
import {
  JOURNAL_BANKS,
  JOURNAL_DISCLOSURE,
  isJournalBankId,
  isJournalMode,
  isShareableGratitude,
  journalBank,
  journalPreview,
  todaysPhrasing,
} from './journal.ts';

describe('the banks', () => {
  it('ships six banks, each one question with a reviewed pool', () => {
    expect(JOURNAL_BANKS).toHaveLength(6);
    for (const b of JOURNAL_BANKS) expect(b.phrasings.length).toBeGreaterThanOrEqual(4);
  });

  it("index 0 is Design's primary line, verbatim", () => {
    expect(journalBank('three_good_things')?.phrasings[0]).toBe(
      'What were three good things about today? Small ones count.',
    );
    expect(journalBank('park_a_worry')?.phrasings[0]).toBe(
      "What's circling? Put it down here — it'll keep until tomorrow.",
    );
    expect(journalBank('whats_actually_true')?.phrasings[0]).toBe(
      "Take the loudest thought you've had today. What's actually true about it?",
    );
  });

  it('asks questions, never worksheet headings', () => {
    for (const b of JOURNAL_BANKS) {
      for (const p of b.phrasings) expect(p).toMatch(/[?.]$/);
    }
  });

  it('never uses clinical or banned words in a prompt', () => {
    for (const b of JOURNAL_BANKS) {
      for (const p of b.phrasings) {
        expect(p).not.toMatch(/captured|anxiet|depress|symptom|therap|journal(ing)? practice|CBT/i);
      }
    }
  });

  it('validates ids and modes', () => {
    expect(isJournalBankId('a_win')).toBe(true);
    expect(isJournalBankId('mood')).toBe(false);
    expect(isJournalMode('paper')).toBe(true);
    expect(isJournalMode('audio')).toBe(false);
  });
});

describe('todaysPhrasing — deterministic rotation', () => {
  const bank = journalBank('three_good_things');
  if (!bank) throw new Error('bank missing');

  it('is stable within a day and drawn from the pool', () => {
    const p = todaysPhrasing(bank, '2026-08-03');
    expect(p).toBe(todaysPhrasing(bank, '2026-08-03'));
    expect(bank.phrasings).toContain(p);
  });

  it('rotates across days', () => {
    const seen = new Set(
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((d) => todaysPhrasing(bank, d)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('the share trigger — kept prompt, never content', () => {
  it('offers sharing on gratitude banks only', () => {
    expect(isShareableGratitude('three_good_things', false)).toBe(true);
    expect(isShareableGratitude('savor_it', false)).toBe(true);
    expect(isShareableGratitude('park_a_worry', false)).toBe(false);
    expect(isShareableGratitude(null, false)).toBe(false);
  });

  it('never offers sharing on a secret entry', () => {
    expect(isShareableGratitude('three_good_things', true)).toBe(false);
  });
});

describe('journalPreview — the first line, never a summary', () => {
  it('takes the first non-empty line verbatim', () => {
    expect(journalPreview({ body: 'Maya stayed on the phone.\nMore below.', mode: 'typed' })).toBe(
      'Maya stayed on the phone.',
    );
  });

  it('ellipsizes long lines without rewriting them', () => {
    const long = 'a'.repeat(200);
    const p = journalPreview({ body: long, mode: 'typed' });
    expect(p.endsWith('…')).toBe(true);
    expect(p.length).toBeLessThanOrEqual(92);
  });

  it('renders paper as the shelf row line', () => {
    expect(journalPreview({ body: '', mode: 'paper' })).toBe('In your physical journal');
  });
});

describe('the disclosure', () => {
  it('is the owner-approved line, said in the coach voice', () => {
    expect(JOURNAL_DISCLOSURE).toMatch(/^I keep your notes/);
    expect(JOURNAL_DISCLOSURE).not.toMatch(/private/i); // Design's word is "secret"
  });
});
