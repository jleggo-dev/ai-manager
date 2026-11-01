/**
 * What the summarizer keeps when it folds an old summary into a new one.
 *
 * P3 (2026-10-31): round two, told only to "fold the transcript into it", dropped round one's
 * decision, constraint and thing-that-failed and spent its words on her advice. Two lines fixed it
 * on short fixtures: the old summary's facts outrank new material, and advice she gave is DROP.
 *
 * P3c (2026-11-01): at production sizes (~40 dialogue rows a round, three rounds) those two lines
 * were not obeyed. Retention 53%: facts first summarized in round one kept 17%, decisions 11%,
 * constraints 22%. Round two re-wrote its prose from scratch, restated her advice, and closed on a
 * sentence claiming everything had been "integrated". The summary is now a list under seven fixed
 * headings, and the fold is mechanical: copy every existing line, replace a line only when the
 * transcript corrects it, then add. Measured the same night: 94% (48/51), round-one facts 100%.
 * Each rule below is pinned so a config regeneration that loses one fails CI. The numbers are in
 * docs/cadence/HARNESS-V3.md C5.4 ("Built (P3c)").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string } }>;
};
const template = config.jobs.find((j) => j.slug === 'coach-compact')?.config.promptTemplate ?? '';

/** The output headings, in the KEEP order. The coach reads them; the fold copies under them. */
const HEADINGS = [
  'DECIDED:',
  'CONSTRAINTS:',
  'CORRECTIONS:',
  'THEIR WORDS:',
  'STILL OPEN:',
  'TRIED AND DID NOT WORK:',
  'WHERE THINGS STAND:',
];

describe('coach-compact — the summary is a structured list', () => {
  it('names the seven headings, each on its own line, in the KEEP order', () => {
    const at = HEADINGS.map((h) => template.indexOf(`\n${h}\n`));
    for (const [i, h] of HEADINGS.entries()) expect(at[i], h).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('writes one fact per line, and an empty heading says so', () => {
    expect(template).toContain('one line per fact, each starting with "- "');
    expect(template).toContain('A heading with nothing under it gets the line "- none"');
  });

  it('is no longer 200 words of prose', () => {
    expect(template).not.toContain('No headings and no bullets');
    expect(template).not.toContain('Aim for 200 words');
  });
});

describe('coach-compact — the fold is mechanical', () => {
  it('ranks the existing summary above the new transcript', () => {
    expect(template).toContain('Every fact the existing summary holds outranks anything new in the transcript');
    expect(template).toContain('carry each one forward unless the transcript corrects it');
  });

  it('copies every existing line word for word, and deletes one only when the transcript says so', () => {
    expect(template).toContain('copy every line under the same heading, word for word');
    expect(template).toContain('Delete any other existing line only for a reason in step 4');
    expect(template).toContain('Never delete one to save words');
  });

  it('a correction removes the old value from every heading, and only THEIR corrections count', () => {
    expect(template).toContain('find every line, under every heading, that states the old value');
    expect(template).toContain('The old value must appear nowhere in the summary');
    expect(template).toContain('Never write the value it replaced, here or anywhere else');
    expect(template).toContain('Never something she corrected or explained to them');
  });

  it('reads a summary written in the old prose format', () => {
    expect(template).toContain('If it is plain paragraphs (an older format)');
  });

  it('still folds into ONE summary, never a summary of a summary', () => {
    expect(template).toContain('never a summary of a summary');
  });
});

describe('coach-compact — what never goes in', () => {
  it('drops the advice she gave, under every heading, and keeps what they said', () => {
    expect(template).toContain('Advice she gave never goes in, under any heading');
    expect(template).toMatch(/DROP\. Write no line for any of these:\n- Advice she gave/);
    expect(template).toContain('Keep what THEY said, decided, corrected or tried');
    expect(template).toContain('A suggestion of hers that they did not clearly take up is advice');
  });

  it('keeps only the names THEY made up, never common terms or hers', () => {
    expect(template).toContain('a name they made up for something of their own');
    expect(template).toContain('Never a common term');
  });

  it('ends on the facts: no closing line claiming what was kept or integrated', () => {
    expect(template).toContain('no closing line saying what was kept, combined or integrated');
    expect(template).toContain('The summary ends with the WHERE THINGS STAND line');
  });

  it('caps the length at 500 words, and shortens lines before it would drop one', () => {
    expect(template).toContain('At most 500 words');
    expect(template).toContain('Never delete a line to make room');
  });
});
