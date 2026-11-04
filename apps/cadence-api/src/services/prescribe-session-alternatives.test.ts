/**
 * Walkthrough v3 R3 (owner, 2026-11-03): the coach writes 2 to 3 alternatives and a suggested load
 * beside each strength or cardio item when she builds the session. Pinned against the config
 * sync-jobs ships, like the other prescribe-session tests, because what reaches the model is the
 * config and not the source.
 *
 * Two things must hold. The returned shape carries the two fields with the alternative's own
 * quantities and equipment — and NO reason field (owner ruling: the swap rows show the name,
 * target, equipment and history, nothing written by the coach about why). And the rule that asks
 * for them names no move and tells her nothing about which to pick ("facts, not picks").
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const config = JSON.parse(readFileSync(path.join(root, 'config/ai-admin/ai-admin.config.json'), 'utf8')) as {
  jobs: Array<{ slug: string; config: { promptTemplate: string } }>;
};

const template = config.jobs.find((j) => j.slug === 'prescribe-session')?.config.promptTemplate ?? '';
const shape = template.split('\n').find((l) => l.startsWith('{ "blocks":')) ?? '';
const rule = template.split('\n').find((l) => l.startsWith('- ALTERNATIVES:')) ?? '';

describe('prescribe-session — the returned item carries alternatives and a suggested load', () => {
  it('names both fields in the JSON shape', () => {
    expect(shape).toContain('"suggested_load": string|null');
    expect(shape).toContain('"alternatives": [ { "name": string');
  });

  it('an alternative has its own quantities, a cue, a search phrase and the equipment it uses', () => {
    const alt = shape.slice(shape.indexOf('"alternatives": ['), shape.indexOf('] ]'));
    for (const field of ['sets', 'reps', 'load', 'duration_min', 'distance_km', 'detail', 'video_query']) {
      expect(alt).toContain(`"${field}":`);
    }
    expect(alt).toContain('"equipment": [string]');
  });

  it('writes no reason anywhere in the shape', () => {
    expect(shape).not.toMatch(/reason|why|rationale/i);
  });
});

describe('prescribe-session — the ALTERNATIVES rule', () => {
  it('asks for 2 to 3 per strength or cardio item, with quantities and equipment, and the suggested load', () => {
    expect(rule).not.toBe('');
    expect(rule).toContain('2 to 3 alternatives');
    expect(rule).toContain('each with its own quantities and the equipment it uses');
    expect(rule).toContain('"suggested_load"');
    expect(rule).toContain('in their own units');
  });

  it('states the cap as a fact about the app', () => {
    expect(rule).toContain('The app keeps at most 3');
  });

  it.each([
    /\bbridge\b/i,
    /\bsquat/i,
    /\bthrust/i,
    /\blunge/i,
    /\bpress/i,
    /\brow\b/i,
    /\bplank/i,
    /\bcarr(y|ies)\b/i,
    /\bhangs?\b/i,
    /\bcurl/i,
    /\bdeadlift/i,
    /\bpush-?ups?\b/i,
    /\bpull-?ups?\b/i,
    /\bkettlebell|dumbbell|barbell|band\b/i,
  ])('names no move or implement: %s', (pattern) => {
    expect(rule).not.toMatch(pattern);
  });

  it('never tells her which alternative to prefer, and asks for no reason', () => {
    expect(rule).not.toMatch(/prefer|best|easier|harder|instead of|reason|why/i);
  });
});
