/**
 * Bug (2026-09-03): `generate-meal-plan` shipped `<slots>{{slots}}</meals_per_day>` — the opener
 * and closer named different fields. Nothing threw; the model just read a tag that never closed.
 *
 * Every job prompt in the config sync-jobs ships wraps its data in `<field>{{field}}</field>`
 * blocks and mentions the same names in prose ("never include anything in <allergies>"). This
 * test walks every promptTemplate and pins two rules that catch a mis-paired tag without
 * tripping on the prose mentions:
 *
 *   1. every `</name>` closes a `<name>` that was opened earlier and not yet closed;
 *   2. a `<name>` that is immediately followed by a `{{placeholder}}` is a data block, and the
 *      very next tag after it must be its own `</name>`.
 *
 * Only `<word>` / `</word>` tokens are audited. JSON braces and `{{var}}` placeholders are left
 * alone.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate?: string } }>;
};

type Tag = { name: string; closing: boolean; index: number; end: number };

const TAG = /<(\/?)([A-Za-z_][\w-]*)>/g;
const PLACEHOLDER_AHEAD = /^\s*\{\{\s*[\w.-]+\s*\}\}/;

const tagsIn = (template: string): Tag[] =>
  [...template.matchAll(TAG)].map((m) => ({
    name: m[2] ?? '',
    closing: m[1] === '/',
    index: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));

/** Returns a list of problems; empty when every tag pairs up. */
export const auditPromptTags = (template: string): string[] => {
  const problems: string[] = [];
  const tags = tagsIn(template);
  const open: Tag[] = [];

  tags.forEach((tag, i) => {
    if (tag.closing) {
      const at = open.map((t) => t.name).lastIndexOf(tag.name);
      if (at === -1) problems.push(`</${tag.name}> at ${tag.index} closes a tag that was never opened`);
      else open.splice(at, 1);
      return;
    }
    open.push(tag);
    if (!PLACEHOLDER_AHEAD.test(template.slice(tag.end))) return;
    const next = tags[i + 1];
    if (!next || !next.closing || next.name !== tag.name) {
      const found = next ? `<${next.closing ? '/' : ''}${next.name}>` : 'end of prompt';
      problems.push(`<${tag.name}> at ${tag.index} wraps {{...}} but is followed by ${found}, not </${tag.name}>`);
    }
  });

  return problems;
};

describe('auditPromptTags — the rules themselves', () => {
  it('accepts a prose mention followed by a data block of the same name', () => {
    expect(auditPromptTags('Respect <diet>.\n<diet>{{diet}}</diet>')).toEqual([]);
  });

  it('flags the shipped bug: an opener and closer that name different fields', () => {
    expect(auditPromptTags('<slots>{{slots}}</meals_per_day>')).toEqual([
      '<slots> at 0 wraps {{...}} but is followed by </meals_per_day>, not </slots>',
      '</meals_per_day> at 16 closes a tag that was never opened',
    ]);
  });

  it('flags a data block closed by a name that was mentioned in prose earlier', () => {
    expect(auditPromptTags('Use <week_of>.\n<slots>{{slots}}</week_of>')).toHaveLength(1);
  });

  it('flags a data block that never closes', () => {
    expect(auditPromptTags('<slots>{{slots}}\n<diet>{{diet}}</diet>')).toHaveLength(1);
  });

  it('ignores JSON braces, comparison operators, and {{var}} placeholders', () => {
    expect(auditPromptTags('{ "a": {{x}}, "b": "<= 3", "c": "a < b > c" }')).toEqual([]);
  });
});

const templates = config.jobs
  .filter((j) => typeof j.config.promptTemplate === 'string')
  .map((j) => [j.slug, j.config.promptTemplate!] as const);

describe('every job promptTemplate in the config sync-jobs ships', () => {
  it('has at least one job to audit', () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates)('%s — every <tag> pairs with its own </tag>', (_slug, template) => {
    expect(auditPromptTags(template)).toEqual([]);
  });
});
