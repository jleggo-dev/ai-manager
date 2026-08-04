import { describe, expect, it } from 'vitest';
import { journalExportFilename, journalToMarkdown } from './journal-export.ts';
import type { JournalEntry } from './journal.ts';

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  entry_id: 'e1',
  created_at: '2026-08-02T20:00:00.000Z',
  bank: 'three_good_things',
  prompt: 'What were three good things about today? Small ones count.',
  body: 'Maya stayed on the phone the whole drive home.',
  secret: false,
  mode: 'typed',
  ...over,
});

describe('the export gives the words back', () => {
  it('keeps the body verbatim and the question that prompted it', () => {
    const md = journalToMarkdown([entry()]);
    expect(md).toContain('Maya stayed on the phone the whole drive home.');
    expect(md).toContain('*What were three good things about today? Small ones count.*');
  });

  // The key locks entries against the COACH, never against the person who wrote them.
  it('includes secret entries, labelled', () => {
    const md = journalToMarkdown([entry({ secret: true, body: 'Some things about Dad.' })]);
    expect(md).toContain('Some things about Dad.');
    expect(md).toMatch(/## .*· secret/);
    expect(md).toContain('1 marked secret');
  });

  it('reads forward in time, unlike the shelf', () => {
    const md = journalToMarkdown([
      entry({ entry_id: 'b', created_at: '2026-08-03T09:00:00.000Z', body: 'SECOND' }),
      entry({ entry_id: 'a', created_at: '2026-08-01T09:00:00.000Z', body: 'FIRST' }),
    ]);
    expect(md.indexOf('FIRST')).toBeLessThan(md.indexOf('SECOND'));
  });

  it('says plainly that a paper entry has no words here', () => {
    const md = journalToMarkdown([entry({ mode: 'paper', body: '', secret: true, prompt: null })]);
    expect(md).toContain('_Written on paper._');
  });

  it('treats an empty journal as a real state, not an error', () => {
    const md = journalToMarkdown([]);
    expect(md).toContain('Nothing written yet.');
    expect(md).not.toContain('---');
  });

  // Someone's prose starting with "# " is prose. The export must render what they wrote, never
  // let their own words restructure the document around them.
  it("never lets a writer's line become markup", () => {
    const md = journalToMarkdown([entry({ body: '# Chapter one\n---\n> he said' })]);
    expect(md).toContain('\\# Chapter one');
    expect(md).toContain('\\---');
    expect(md).toContain('\\> he said');
  });

  it('interprets nothing — no themes, counts, or sentiment', () => {
    const md = journalToMarkdown([entry(), entry({ entry_id: 'e2', body: 'Another day.' })]);
    expect(md).not.toMatch(/sentiment|theme|mood|score|streak|average|most often|trend/i);
  });

  it('stamps when it was exported so a file found later explains itself', () => {
    const md = journalToMarkdown([entry()], { exportedAt: '2026-08-04T10:00:00.000Z' });
    expect(md).toContain('exported Tuesday 4 August 2026');
  });
});

describe('the filename', () => {
  it('is stable and sortable', () => {
    expect(journalExportFilename('2026-08-04T10:00:00.000Z')).toBe('cadence-journal-2026-08-04.md');
    expect(journalExportFilename('nonsense')).toBe('cadence-journal-export.md');
  });
});
