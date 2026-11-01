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
  sentences,
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
 * REAL policy and the REAL persona: at least two compactions, and every planted fact behind the
 * final mark WITH A ROUND TO SPARE. A fact first summarized in the last round is never folded, and
 * a fact past the final mark is never summarized at all — the eval would score it as lost when it
 * was never tested (2026-10-31: #445 sized the kept tail in units and moved the mark only as far as
 * the summarizer read, and the piano fixture's last fact stayed in the tail).
 *
 * IF THIS FAILS AFTER A POLICY CHANGE (`coach-compaction-policy.ts`) or an engine change
 * (`planCompaction`), fix the FIXTURES: add exchanges after the last planted fact
 * (`exchanges` in `eval-compaction-fixtures.ts`) or plant the last facts earlier.
 */
describe.each(COMPACTION_FIXTURES)('fixture $id', (fixture) => {
  it('with the LIVE policy (coach-compaction-policy.ts): compacts at least twice, and every planted fact is behind the final mark with a round to spare', async () => {
    const built = buildFixtureRows(fixture, persona);
    const { rounds } = await replayCompaction(built, COACH_SUMMARIZER, fakeSummarize);
    expect(rounds.length).toBeGreaterThanOrEqual(2);
    const facts = compactedFacts(fixture, built, rounds);
    expect(facts.map((f) => f.id)).toEqual(fixture.facts.map((f) => f.id));
    expect(new Set(facts.map((f) => f.round)).size).toBeGreaterThanOrEqual(2);
    // Every fact is folded at least once: none is first summarized in the final round.
    expect(facts.filter((f) => f.round === rounds.length).map((f) => f.id)).toEqual([]);
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

const fact = (id: string) => ({ ...COMPACTION_FIXTURES.flatMap((f) => f.facts).find((f) => f.id === id)!, round: 1 });

describe('scoreFact — a fact with two groups', () => {
  const decision = fact('run-decision'); // Thursday + 30 minutes
  it.each([
    ['They agreed Thursday is an easy 30-minute run.', true],
    ['Thursday: easy run of half an hour.', false], // "half an hour" is not a listed term — a near-miss
    ['Thursdays are a half-hour easy run.', true],
    ['An easy 30 minute run, day not set.', false],
    ['THURSDAY EASY 30 MIN', true],
  ])('%s → %s', (summary, kept) => {
    expect(scoreFact(summary, decision).kept).toBe(kept);
  });

  it('reports which group was missing, and no stale sentences for a fact that is not a correction', () => {
    const r = scoreFact('Thursday easy run.', decision);
    expect(r.missing).toEqual([decision.expect[1]]);
    expect(r.stale).toEqual([]);
  });
});

/**
 * The correction rule (`scoreFact`): the replaced value may appear only in a sentence that also
 * holds the new value. Positives record the change; near-misses state the old value on its own.
 */
describe('scoreFact — a correction fails while the summary still states the old value', () => {
  it.each([
    // The change recorded in one sentence: kept.
    ['The race moved from October 12 to November 2.', true],
    ['Race day is November 2nd (it was October 12th).', true],
    ['They corrected the race date to November 2nd, not October 12th.', true],
    ['The race is Nov 2; originally Oct 12.', true],
    ['Race day is November 2nd.', true],
    // The old value standing alone in its own sentence: not kept.
    ['Race day is October 12th. They later said it is November 2nd.', false],
    ['Race day is Oct. 12. Moved to Nov. 2.', false],
    ['Their race is the Harbourfront Half on October 12th.\nThe race is now November 2nd.', false],
    // The new value missing: not kept, whatever else is there.
    ['Race day is October 12th.', false],
    ['The race moved to November.', false],
  ])('race: %s → %s', (summary, kept) => {
    expect(scoreFact(summary, fact('run-correction')).kept).toBe(kept);
  });

  it.each([
    ['They switched from the Chopin nocturne to Satie’s Gymnopédie No. 1.', true],
    ['They dropped the Chopin and are learning Satie now.', true],
    ['They are learning Satie now.', true],
    // Honest, but the second sentence names the old piece alone — the rule is strict on purpose.
    ['They are learning Satie now. They dropped the Chopin nocturne.', false],
    ['They are working on a Chopin nocturne. They also mentioned a Gymnopédie.', false],
  ])('piece: %s → %s', (summary, kept) => {
    expect(scoreFact(summary, fact('mind-correction')).kept).toBe(kept);
  });

  it.each([
    ['They were vegetarian and now eat fish again — pescatarian.', true],
    ['Pescatarian now.', true], // "pescatarian" does not contain "vegetarian"
    ['They are vegetarian. Since then they became pescatarian.', false],
  ])('diet: %s → %s', (summary, kept) => {
    expect(scoreFact(summary, fact('food-correction')).kept).toBe(kept);
  });

  it('quotes the sentence that still states the old value', () => {
    const r = scoreFact('Race day is October 12th. The race moved to November 2nd.', fact('run-correction'));
    expect(r.missing).toEqual([]);
    expect(r.stale).toEqual(['Race day is October 12th.']);
  });
});

/** Where the correction rule cuts a summary into sentences (SENTENCE_BREAK). */
describe('sentences', () => {
  it.each([
    // Breaks.
    ['One. Two.', ['One.', 'Two.']],
    ['Done! Next? Yes.', ['Done!', 'Next?', 'Yes.']],
    ['Line one\nLine two', ['Line one', 'Line two']],
    ['First paragraph.\n\nSecond paragraph.', ['First paragraph.', 'Second paragraph.']],
    ['They said "stop." Then they ran.', ['They said "stop."', 'Then they ran.']],
    ['Runs at 6 a.m. They stopped.', ['Runs at 6 a.m.', 'They stopped.']],
    ['It moved. "Now" it is later.', ['It moved.', '"Now" it is later.']],
    ['Easy run. Élan returned.', ['Easy run.', 'Élan returned.']],
    // Near-misses: a full stop that does not end a sentence.
    ['The race is Oct. 12 now.', ['The race is Oct. 12 now.']],
    ['Learning Gymnopédie No. 1 now.', ['Learning Gymnopédie No. 1 now.']],
    ['Runs at 6 a.m. and then work.', ['Runs at 6 a.m. and then work.']],
    ['e.g. this one.', ['e.g. this one.']],
    ['Version 2.5 is out.', ['Version 2.5 is out.']],
  ])('%j → %j', (text, expected) => {
    expect(sentences(text)).toEqual(expected);
  });
});

describe('leaks', () => {
  it('flags injected text in a summary, and nothing in a clean one', () => {
    expect(leaks('Context: <context source="turn-context"> stuff')).toEqual(['<context', 'source="']);
    expect(leaks('They run Thursdays.')).toEqual([]);
  });
});
