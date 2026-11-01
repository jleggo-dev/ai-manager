/**
 * The `describe-meal-photo` job as the config ships it (FOOD-LOGGING-COACH-LED.md, build step 4):
 * a text job whose reading is plain — no asterisks, no bold headings, no bullet marks — and
 * ends with the list the photo door reads (meal-photo-read.ts `readingWords`): one line per food
 * or drink, the amount first, nothing after it. The owner found "***" and "**Compact Summary for
 * Data Entry:**" in the editable reading (2026-10-31); this pins the rules that keep them out, and
 * runs the prompt's own example list through the split so the shape it asks for is the shape the
 * code reads.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partsToLookups } from './food-candidate-book.ts';
import { readingWords } from './meal-photo-read.ts';

interface Job {
  slug: string;
  config: {
    expectedResponseFormat?: string;
    promptTemplate: string;
    variables?: Array<{ name: string; required?: boolean }>;
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Job[];
};
const job = config.jobs.find((j) => j.slug === 'describe-meal-photo');
const template = job?.config.promptTemplate ?? '';

describe('describe-meal-photo job config', () => {
  it('exists once, answers in text, and declares the one placeholder it uses', () => {
    expect(config.jobs.filter((j) => j.slug === 'describe-meal-photo')).toHaveLength(1);
    expect(job?.config.expectedResponseFormat).toBe('text');
    const used = [...new Set([...template.matchAll(/\{\{([\w.-]+)\}\}/g)].map((m) => m[1]))].sort();
    expect(template).not.toMatch(/\{\{\s|\s\}\}/);
    expect(used).toEqual((job?.config.variables ?? []).map((v) => v.name).sort());
    expect(template).toContain('<caption>{{caption}}</caption>');
  });

  it('asks for plain text: the marks the owner saw in the reading are each named', () => {
    expect(template).toContain(
      'Plain text only: no asterisks, no bold, no headings, no bullet marks, no numbering, no JSON.',
    );
    expect(template).toContain('A line of the list starts with the amount, not with a mark.');
    // The old invitation that produced "**Compact Summary for Data Entry:**" is gone.
    expect(template).not.toMatch(/structured summary/i);
    expect(template).not.toMatch(/Do not force JSON/);
  });

  it('asks for the shape the photo door reads: sentences, a blank line, the list last', () => {
    expect(template).toContain('Format: plain text in two parts, in this order.');
    expect(template).toContain('Then a blank line, then the list: one line per food or drink, the amount first');
    expect(template).toContain('Nothing after the list.');
    expect(template).toContain('No commas, no "and", no "with", no "&" inside a line.');
    expect(template).toContain('the qualifiers go before the food');
  });

  it('its own example list splits into one lookup per line, each with an amount', () => {
    const example = template.slice(template.indexOf('Like this:\n') + 'Like this:\n'.length);
    const lines = example.slice(0, example.indexOf('\nNothing after the list')).split('\n');
    expect(lines).toHaveLength(4);
    const { words, notes } = readingWords(`A latte and a banana on the table.\n\n${lines.join('\n')}`);
    expect(notes).toBe('A latte and a banana on the table.');
    const lookups = partsToLookups(words);
    expect(lookups.map((l) => l.q)).toEqual(['venti Starbucks latte', 'banana', 'fried eggs', 'buttered sourdough']);
    expect(lookups.every((l) => l.measure)).toBe(true);
  });

  it('keeps the rules the app relies on', () => {
    expect(template).toContain('COMMIT TO A READING, AND NAME THE ASSUMPTION YOU COMMITTED TO');
    expect(template).toContain('Never name a food you cannot actually see');
    expect(template).toContain('If there is no food or drink in the photo at all, say only that, with no list.');
    expect(template).toContain('Never infer a chain from a cup that merely looks like theirs');
    // The brand goes on the list line, where the split keeps it with its food.
    expect(template).toContain('Put it on the line ("1 venti Starbucks latte")');
  });

  it('promises only what the code does: the person corrects the list, and only the list is looked up', () => {
    // The eyes' sentences go to the log row, not to the food-check call (review of #457); the
    // prompt must not say the coach reads them.
    expect(template).toContain('the person reads your sentences and corrects the list, and only the list is looked up');
    expect(template).not.toContain('the coach will state an assumption or ask the person exactly where you flag it');
    expect(template).toContain('the person confirms the list, so make an assumed amount plain enough to correct');
    expect(template).not.toMatch(/pick the (flattering|alarming)/i);
  });

  it('its description says what it is now — plain text ending in a list — not "format-flexible"', () => {
    const description = (job as unknown as { description: string } | undefined)?.description ?? '';
    expect(description).toContain('plain text');
    expect(description).toContain('list of "amount food" lines');
    expect(description).not.toMatch(/format-flexible|stage 2 does the schema/i);
  });

  it.each([/\bcaptured\b/i, /\bjourney\b/i, /\bunlock\b/i, /\bempower/i, /\btempo\b/i, /\bCadence\b/])(
    'carries no banned word: %s',
    (word) => {
      expect(template).not.toMatch(word);
    },
  );
});
