import { describe, expect, it } from 'vitest';
import { PRACTICES, expandPractice, isPracticeId, practiceById } from './practices.ts';
import { SESSION_TOOL_KINDS } from './tool-catalog.ts';
import { deriveWalkthrough } from './walkthrough.ts';
import { isJournalBankId } from './journal.ts';
import { isBreathPatternId } from './breathing.ts';
import { isGroundingGame } from './grounding.ts';

describe('the practice trees', () => {
  it('ships three practices, each a real sequence', () => {
    expect(PRACTICES).toHaveLength(3);
    for (const p of PRACTICES) expect(p.items.length).toBeGreaterThanOrEqual(3);
  });

  it('composes ONLY from tools that exist — a practice can never name a renderer we lack', () => {
    for (const p of PRACTICES) {
      for (const i of p.items) {
        expect(i.tool).toBeDefined();
        expect(SESSION_TOOL_KINDS).toContain(i.tool);
      }
    }
  });

  it('references only real patterns, banks and games', () => {
    for (const p of PRACTICES) {
      for (const i of p.items) {
        if (i.breath_pattern) expect(isBreathPatternId(i.breath_pattern)).toBe(true);
        if (i.journal_bank) expect(isJournalBankId(i.journal_bank)).toBe(true);
        if (i.grounding_game) expect(isGroundingGame(i.grounding_game)).toBe(true);
      }
    }
  });

  it('never says CBT, never diagnoses, never claims a thought is false', () => {
    const all = JSON.stringify(PRACTICES).toLowerCase();
    expect(all).not.toMatch(/\bcbt\b|cognitive behav|distortion|irrational|anxiety disorder|symptom/);
    // "what's actually true" is the honest framing; "that's not true" would be a claim we can't make.
    expect(all).not.toMatch(/not true|wrong thought|false belief/);
  });

  it('never stacks feeling_log straight after grounding (the owner ruling holds inside trees too)', () => {
    for (const p of PRACTICES) {
      p.items.forEach((i, idx) => {
        if (i.tool === 'feeling_log') expect(p.items[idx - 1]?.tool).not.toBe('grounding');
      });
    }
  });

  it('validates ids', () => {
    expect(isPracticeId('evening_review')).toBe(true);
    expect(isPracticeId('therapy')).toBe(false);
    expect(practiceById('worry_park')?.name).toBe('Park it');
  });
});

describe('expandPractice — a tree becomes a playable session', () => {
  it('plays through the ordinary walkthrough projection', () => {
    const session = expandPractice('evening_review');
    expect(session).not.toBeNull();
    const w = deriveWalkthrough(session);
    expect(w.steps.map((s) => s.tool.kind)).toEqual(['breathing', 'feeling_log', 'journal', 'journal']);
  });

  it('carries the journal banks into the steps, so entries keep their question', () => {
    const w = deriveWalkthrough(expandPractice('thought_reframe'));
    const journals = w.steps.filter((s) => s.tool.kind === 'journal');
    expect(journals.length).toBeGreaterThanOrEqual(4);
    // The coach's own question wins where one is written; the bank supplies the rest.
    expect(journals.some((s) => s.tool.kind === 'journal' && s.tool.bank === 'whats_actually_true')).toBe(true);
  });

  it('returns null for an unknown practice rather than inventing one', () => {
    expect(expandPractice('made_up')).toBeNull();
    expect(expandPractice(null)).toBeNull();
  });
});
