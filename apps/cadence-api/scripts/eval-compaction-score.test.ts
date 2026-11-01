import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COACH_SUMMARIZER } from '../src/services/coach-compaction-policy.ts';
import { COMPACTION_FIXTURES, FACT_KINDS } from './eval-compaction-fixtures.ts';
import {
  buildFixtureRows,
  compactedFacts,
  leaks,
  plantSpan,
  replayCompaction,
  scoreFact,
  type Summarize,
} from './eval-compaction-score.ts';

const persona = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../config/ai-admin/cadence-coach.system-prompt.md'),
  'utf8',
);
/** About the length `coach-compact` is told to aim for (≤400 words). */
const fakeSummarize: Summarize = async () => 'They said things. '.repeat(90);

/**
 * The fixtures are only worth running if they exercise what the eval claims to measure — with the
 * REAL policy and the REAL persona: at least two compactions (so round one's facts have to survive
 * being folded into round two), and every planted fact behind the final mark.
 */
describe.each(COMPACTION_FIXTURES)('fixture $id under the live policy', (fixture) => {
  it('compacts at least twice, and every planted fact ends up behind the final mark', async () => {
    const built = buildFixtureRows(fixture, persona);
    const { rounds } = await replayCompaction(built, COACH_SUMMARIZER, fakeSummarize);
    expect(rounds.length).toBeGreaterThanOrEqual(2);
    const facts = compactedFacts(fixture, built, rounds);
    expect(facts.map((f) => f.id)).toEqual(fixture.facts.map((f) => f.id));
    expect(new Set(facts.map((f) => f.round)).size).toBeGreaterThanOrEqual(2);
  });

  it('plants one fact of every kind, never two in one exchange', () => {
    expect(new Set(fixture.facts.map((f) => f.kind))).toEqual(new Set(FACT_KINDS));
    const slots = fixture.facts.flatMap((f) => (f.before ? [f.at, f.before.at] : [f.at]));
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('the summarizer is handed dialogue only — no injected rows, no pinned blocks', async () => {
    const { rounds } = await replayCompaction(buildFixtureRows(fixture, persona), COACH_SUMMARIZER, fakeSummarize);
    for (const r of rounds) {
      expect(r.transcript).not.toContain('<context');
      expect(r.transcript).not.toContain('WHAT YOU CAN DO');
      expect(r.droppedAppRows).toBeGreaterThan(0);
    }
  });

  it("finds every compacted fact's exchange in the transcript of the round that summarized it", async () => {
    const built = buildFixtureRows(fixture, persona);
    const { rounds } = await replayCompaction(built, COACH_SUMMARIZER, fakeSummarize);
    for (const f of compactedFacts(fixture, built, rounds)) {
      const span = plantSpan(f, rounds);
      expect(span, f.id).not.toBeNull();
      expect(span!.end).toBeGreaterThan(span!.start);
      expect(span!.transcriptChars).toBe(rounds[f.round - 1]!.transcript.length);
    }
  });
});

describe('scoreFact', () => {
  const fact = { ...COMPACTION_FIXTURES[0]!.facts[0]!, round: 1 }; // Thursday + 30 minutes
  it.each([
    ['They agreed Thursday is an easy 30-minute run.', true],
    ['Thursday: easy run of half an hour.', false], // "half an hour" is not a listed term — a near-miss
    ['Thursdays are a half-hour easy run.', true],
    ['An easy 30 minute run, day not set.', false],
    ['THURSDAY EASY 30 MIN', true],
  ])('%s → %s', (summary, kept) => {
    expect(scoreFact(summary, fact).kept).toBe(kept);
  });

  it('reports which group was missing', () => {
    expect(scoreFact('Thursday easy run.', fact).missing).toEqual([fact.expect[1]]);
  });
});

describe('leaks', () => {
  it('flags injected text in a summary, and nothing in a clean one', () => {
    expect(leaks('Context: <context source="turn-context"> stuff')).toEqual(['<context', 'source="']);
    expect(leaks('They run Thursdays.')).toEqual([]);
  });
});
