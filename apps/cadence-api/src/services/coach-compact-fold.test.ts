/**
 * What the summarizer keeps when it folds an old summary into a new one.
 *
 * Measured 2026-10-31 (`npm run eval:compaction`, 3 runs): round one's summary carried every
 * planted fact; round two, told only to "fold the transcript into it", dropped the decision, the
 * constraint and the thing-that-failed from the old summary in 3 of 3 runs and spent its words
 * repeating her general advice instead. Facts first summarized in round two kept 95%; facts from
 * round one kept 61%. The two lines pinned here are the fix: the old summary's facts outrank new
 * material, and advice she gave is DROP. A config regeneration that loses either fails CI.
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

describe('coach-compact — folding keeps what the old summary held', () => {
  it('ranks the existing summary above the new transcript', () => {
    expect(template).toContain('Every fact the existing summary holds outranks anything new in the transcript');
    expect(template).toContain('carry each one forward unless the transcript corrects it');
  });

  it('drops the advice she gave, and keeps what they said', () => {
    expect(template).toMatch(/DROP:.*advice she gave/);
    expect(template).toContain('Keep what THEY said, asked, decided, corrected or tried');
  });

  it('still folds into ONE summary, never a summary of a summary', () => {
    expect(template).toContain('never a summary of a summary');
  });
});
