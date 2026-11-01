/**
 * Self-tests for the compaction eval's fixtures: a retention number is only worth reading if a
 * kept fact can only have come from its planting, and if the conversation is the size of a real
 * one. Each test here is the check that would have caught one of the P3 audit findings
 * (HARNESS-V3 C5.4, P3b).
 */
import { describe, expect, it } from 'vitest';
import { COMPACTION_FIXTURES, type PlantedFact } from './eval-compaction-fixtures.ts';
import { composeConversation, poolStrings, PRODUCTION_SIZES } from './eval-compaction-filler.ts';
import { buildFixtureRows, JOB_VARIABLE_CAP } from './eval-compaction-score.ts';

/** Every term the scorer looks for on a fact's behalf, kept or forbidden. */
const termsOf = (f: PlantedFact) => [...f.expect.flat(), ...(f.mustNotContain ?? [])].map((t) => t.toLowerCase());
const textOf = (e: { user: string; coach: string }) => `${e.user}\n${e.coach}`.toLowerCase();
/** [term, text] for every term of `facts` found in `texts` — empty is the pass. */
const hits = (facts: PlantedFact[], texts: string[]) =>
  facts.flatMap((f) =>
    termsOf(f).flatMap((term) => texts.filter((t) => t.toLowerCase().includes(term)).map((t) => [term, t])),
  );

describe.each(COMPACTION_FIXTURES)('fixture $id', (fixture) => {
  const turns = composeConversation(fixture);
  const filler = turns.filter((t) => !t.factId);

  it("no filler line carries a planted fact's terms — a kept fact can only come from its planting", () => {
    // The first fixtures repeated "nuts — not peanuts" through the filler, so the peanut allergy
    // scored as kept against a summary that held only filler.
    expect(
      hits(
        fixture.facts,
        filler.map((t) => textOf(t.exchange)),
      ),
    ).toEqual([]);
  });

  it('nor does any string in its pool, whatever the seed picks', () => {
    expect(hits(fixture.facts, poolStrings(fixture.pool))).toEqual([]);
  });

  it("a fact's terms turn up only in its own planted exchanges", () => {
    for (const f of fixture.facts) {
      const others = fixture.facts
        .filter((o) => o.id !== f.id)
        .flatMap((o) => [o.plant, ...(o.before ? [o.before] : [])])
        .map(textOf);
      expect(hits([f], others), f.id).toEqual([]);
    }
  });

  it('each fact can be scored from its planting: every expect group is met by the plant', () => {
    for (const f of fixture.facts) {
      const text = textOf(f.plant);
      expect(
        f.expect.filter((g) => !g.some((t) => text.includes(t.toLowerCase()))),
        f.id,
      ).toEqual([]);
    }
  });

  it('every correction names the value it replaced, as it was said, and only corrections do', () => {
    for (const f of fixture.facts) {
      expect(Boolean(f.mustNotContain?.length), f.id).toBe(f.kind === 'correction');
      expect(Boolean(f.before), f.id).toBe(f.kind === 'correction');
      if (f.kind !== 'correction') continue;
      const said = textOf(f.before!);
      expect(
        f.mustNotContain!.some((t) => said.includes(t.toLowerCase())),
        f.id,
      ).toBe(true);
    }
  });

  it('filler carries no counters and no placeholders', () => {
    // "Note {n}" came back in summaries as "ratings increasing up to 58".
    for (const t of filler) {
      expect(textOf(t.exchange)).not.toMatch(/\{n\}|\b(day|note|check-in|week note)\s+\d+\b/i);
    }
  });

  it('no two filler exchanges are the same, and no message is sent more than twice', () => {
    const exchanges = filler.map((t) => textOf(t.exchange));
    expect(new Set(exchanges).size).toBe(exchanges.length);
    const counts = new Map<string, number>();
    for (const t of filler) counts.set(t.exchange.user, (counts.get(t.exchange.user) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
  });

  it('is the same conversation on every build (seeded)', () => {
    expect(composeConversation(fixture)).toEqual(turns);
  });

  it('a round of dialogue outgrows the job-variable cap, as real rounds do', () => {
    // The first fixtures summarized ~6K chars a round and never came near the cap. Under the live
    // policy a round summarizes about the first 25–30 exchanges, so their dialogue alone, written
    // the way the engine writes a transcript, must be longer than the cap.
    const dialogue = turns
      .slice(0, 25)
      .map((t) => `user: ${t.exchange.user}\n\nassistant: ${t.exchange.coach}`)
      .join('\n\n');
    expect(dialogue.length).toBeGreaterThan(JOB_VARIABLE_CAP);
  });
});

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const percentile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.ceil(p * xs.length) - 1]!;
const within = (actual: number, target: number, tolerance: number) => Math.abs(actual - target) / target <= tolerance;

/**
 * Sizes match production (`PRODUCTION_SIZES`), all three fixtures pooled. The first fixtures were a
 * third of real length. Tolerances allow for composed text landing near its target, not on it.
 */
describe('sizes match production', () => {
  const filler = COMPACTION_FIXTURES.flatMap((f) => composeConversation(f).filter((t) => !t.factId));
  const user = filler.map((t) => t.exchange.user.length);
  const coach = filler.map((t) => t.exchange.coach.length);
  const context = COMPACTION_FIXTURES.flatMap((f) =>
    buildFixtureRows(f, '')
      .rows.filter((r) => r.content.startsWith('<context source="turn-context"'))
      .map((r) => r.content.length),
  );

  it.each([
    ['their messages, mean', mean(user), PRODUCTION_SIZES.user.mean, 0.15],
    ['their messages, p90', percentile(user, 0.9), PRODUCTION_SIZES.user.p90, 0.15],
    ['her replies, mean', mean(coach), PRODUCTION_SIZES.coach.mean, 0.1],
    ['her replies, p50', percentile(coach, 0.5), PRODUCTION_SIZES.coach.p50, 0.15],
    ['her replies, p90', percentile(coach, 0.9), PRODUCTION_SIZES.coach.p90, 0.15],
    ['injected context per exchange, mean', mean(context), PRODUCTION_SIZES.context.mean, 0.1],
    ['injected context per exchange, p90', percentile(context, 0.9), PRODUCTION_SIZES.context.p90, 0.1],
  ])('%s: %d chars, production %d (±%s)', (_label, actual, target, tolerance) => {
    expect(within(actual, target, tolerance)).toBe(true);
  });
});
