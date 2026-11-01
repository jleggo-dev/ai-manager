/**
 * The `food-check` job and its profile as the config ships them (FOOD-LOGGING-COACH-LED.md,
 * build step 2): on its own small-model profile with the pointers ruling 1 chose, a strict
 * schema whose every object is closed and whose "did not choose" answers are nullable, every
 * placeholder declared, and a prompt that keeps the rules the app relies on — picks from the
 * book only, measures the record offers, no calories written for a pick, an estimate labelled,
 * one question. The round rule is a variable on purpose: the shape, not the wording, bounds the
 * second call (services/food-check.ts).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FOOD_CHECK_JOB } from './food-check.ts';

interface FieldDef {
  type?: string;
  nullable?: boolean;
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
interface Profile {
  slug: string;
  external_ai_id: string;
  failover_external_ai_id?: string;
  runtime_options?: { temperature?: number };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  profiles: Profile[];
  jobs: Job[];
};
const job = config.jobs.find((j) => j.slug === FOOD_CHECK_JOB);
const template = job?.config.promptTemplate ?? '';

/** Every object in a field tree declares its fields — the strict contract's one requirement. */
function openObjects(def: FieldDef | undefined, at: string): string[] {
  if (!def) return [];
  const out: string[] = [];
  if (def.type === 'object' && !def.fields) out.push(at);
  for (const [k, v] of Object.entries(def.fields ?? {})) out.push(...openObjects(v, `${at}.${k}`));
  if (def.type === 'array') {
    if (!def.items?.fields && (def.items?.type ?? 'object') === 'object' && def.items?.type === 'object')
      out.push(`${at}[]`);
    for (const [k, v] of Object.entries(def.items?.fields ?? {})) out.push(...openObjects(v, `${at}[].${k}`));
  }
  return out;
}

describe('food-check job config', () => {
  it('exists, once, on its own profile token', () => {
    expect(config.jobs.filter((j) => j.slug === FOOD_CHECK_JOB)).toHaveLength(1);
    expect(job?.ai_profile_id).toBe('<CADENCE_FOOD_CHECK_PROFILE_UUID>');
  });

  it('its profile carries ruling 1: gpt-5.4-mini primary, claude-sonnet-5-5 failover, low temperature', () => {
    const profile = config.profiles.find((p) => p.slug === 'cadence-food-check');
    expect(profile?.external_ai_id).toBe('gpt-5.4-mini');
    expect(profile?.failover_external_ai_id).toBe('claude-sonnet-5-5');
    expect(profile?.runtime_options?.temperature).toBeLessThanOrEqual(0.2);
  });

  it('declares the single-call shape: items per part, lookups for the one extra round', () => {
    const fields = job?.config.expectedSchema?.fields ?? {};
    expect(Object.keys(fields).sort()).toEqual(['items', 'lookups']);
    const item = fields.items?.items?.fields ?? {};
    expect(Object.keys(item).sort()).toEqual([
      'assumption',
      'brand',
      'count',
      'estimate',
      'measure',
      'name',
      'pick',
      'question',
      'said',
    ]);
    for (const k of ['name', 'brand', 'pick', 'measure', 'count', 'assumption', 'question', 'estimate'])
      expect(item[k]?.nullable, k).toBe(true);
    expect(item.said?.nullable).toBeUndefined();
    expect(Object.keys(item.estimate?.fields ?? {}).sort()).toEqual(['kcal', 'protein_g']);
    expect(Object.keys(fields.lookups?.items?.fields ?? {}).sort()).toEqual(['brand', 'measure', 'q']);
    expect(job?.config.formattingRules?.find((r) => r.type === 'require-keys')?.options?.keys).toEqual([
      'items',
      'lookups',
    ]);
  });

  it('closes every object, so it goes to the gateway strict', () => {
    const fields = job?.config.expectedSchema?.fields ?? {};
    expect(Object.entries(fields).flatMap(([k, v]) => openObjects(v, k))).toEqual([]);
  });

  it('declares every placeholder the prompt uses; the words, the book and the round rule are required', () => {
    const used = [...new Set([...template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]))].sort();
    const declared = (job?.config.variables ?? []).map((v) => v.name).sort();
    expect(used).toEqual(declared);
    for (const name of ['said', 'book', 'round_rule', 'meal']) {
      expect(job?.config.variables?.find((v) => v.name === name)?.required, name).toBe(true);
    }
  });

  it('wraps the words and the book in tags, and puts the round rule where the model reads it', () => {
    expect(template).toContain('<said>{{said}}</said>');
    expect(template).toContain('<book>\n{{book}}\n</book>');
    expect(template).toContain('{{round_rule}}');
    expect(template).toContain('{{guard_notes}}');
  });

  it('keeps the rules the guards rely on', () => {
    expect(template).toContain('Never invent an id');
    expect(template).toContain('one of the measures listed for that record, written exactly as listed');
    expect(template).toContain('Do not write calories or protein for a picked record');
    expect(template).toContain('The app shows it to the person as your estimate');
    expect(template).toContain('the app does not count it until the question is answered');
    expect(template).toContain('A record marked incomplete has no usable calories');
  });

  it('names the near-miss that started this: a plain latte is not a matcha latte', () => {
    expect(template).toContain('"latte" is a plain latte, not a matcha latte');
    expect(template).toContain('"peanut butter" is not powdered peanut butter');
  });

  it('an estimate carries a plain food name and only a brand the person named', () => {
    expect(template).toContain('the plain name of the food as a food list would write it');
    expect(template).toContain('only when they named it');
    expect(template).toContain('Never guess one');
  });

  it('does not offer lookups in the template itself — the round rule variable does, on the first call only', () => {
    expect(template).not.toMatch(/you may (ask|reply with) .*lookups/i);
    expect(template).not.toContain('last reply');
  });

  it.each([/\bcaptured\b/i, /\bjourney\b/i, /\bunlock\b/i, /\bempower/i, /\btempo\b/i])(
    'carries no banned word: %s',
    (word) => {
      expect(template).not.toMatch(word);
    },
  );
});
