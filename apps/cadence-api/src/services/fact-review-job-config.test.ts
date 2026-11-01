/**
 * The `fact-review` job as the config sync-jobs ships it (HARNESS-V3 C7): on the same pinned
 * gpt-class profile as capture-extract (strict json_schema is ~free there, CLAUDE.md "Broker
 * model"), a schema whose kinds are the app's own, every placeholder declared, and a prompt that
 * keeps the rules the app relies on — evidence required, the near-misses spelled out, a question
 * rather than advice.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FINDING_KINDS } from './fact-review-findings.ts';

/** The slug fact-review.ts calls (its own test pins the same string). Not imported: that module
 *  loads the DB client, which CI has no secret for. */
const FACT_REVIEW_JOB = 'fact-review';

interface FieldDef {
  type?: string;
  allowedValues?: string[];
  fields?: Record<string, FieldDef>;
  items?: { type?: string; fields?: Record<string, FieldDef> };
}
interface Job {
  slug: string;
  ai_profile_id: string;
  config: {
    promptTemplate: string;
    variables?: Array<{ name: string; required?: boolean }>;
    expectedSchema?: { fields?: Record<string, FieldDef> };
    formattingRules?: Array<{ type: string; options?: { keys?: string[] } }>;
  };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Job[];
};
const job = config.jobs.find((j) => j.slug === FACT_REVIEW_JOB);
const template = job?.config.promptTemplate ?? '';

describe('fact-review job config', () => {
  it('exists, once', () => {
    expect(config.jobs.filter((j) => j.slug === FACT_REVIEW_JOB)).toHaveLength(1);
  });

  it("runs on capture-extract's pinned gpt-class profile", () => {
    const capture = config.jobs.find((j) => j.slug === 'capture-extract');
    expect(job?.ai_profile_id).toBe(capture?.ai_profile_id);
  });

  it("declares a strict findings schema whose kinds are the app's own", () => {
    const items = job?.config.expectedSchema?.fields?.findings?.items?.fields ?? {};
    expect(Object.keys(items).sort()).toEqual(['evidence', 'fact_ids', 'kind', 'question']);
    expect(items.kind?.allowedValues).toEqual([...FINDING_KINDS]);
    expect(items.fact_ids).toMatchObject({ type: 'array', items: { type: 'string' } });
    expect(job?.config.formattingRules?.find((r) => r.type === 'require-keys')?.options?.keys).toEqual(['findings']);
  });

  it('declares every placeholder the prompt uses, and the facts are required', () => {
    const used = [...template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]).sort();
    const declared = (job?.config.variables ?? []).map((v) => v.name).sort();
    expect([...new Set(used)]).toEqual(declared);
    expect(job?.config.variables?.find((v) => v.name === 'facts')?.required).toBe(true);
  });

  it('requires evidence that quotes the facts by id', () => {
    expect(template).toContain('Evidence is required');
    expect(template).toContain('quote each fact by its id');
  });

  it('spells out the near-misses it must not report', () => {
    expect(template).toContain('"20 lb dumbbells" and "35 lb dumbbells" are two pairs, and both are true');
    expect(template).toContain('A constraint and an equipment item about the same body part');
    expect(template).toContain('Anything already in <already_asked>');
  });

  it('asks a question and gives no advice', () => {
    expect(template).toContain('you give no advice');
    expect(template).toContain('Do not suggest what to do');
    expect(template).toContain('Do not say which fact is right');
  });

  it.each([/\bcaptured\b/i, /\bjourney\b/i, /\bunlock\b/i, /\bempower/i])('carries no banned word: %s', (word) => {
    expect(template).not.toMatch(word);
  });
});
