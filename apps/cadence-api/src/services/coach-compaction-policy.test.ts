import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SummarizerConfig } from '@ai-admin/core';
import { COACH_SUMMARIZER, KEEP_NEWEST_CONTEXT, KEEP_NEWEST_CONTEXT_SOURCES } from './coach-compaction-policy.ts';
import { APP_AUTHORED, PINNED_CONTEXT } from './coach-turns.ts';

/**
 * The coach's compaction policy (HARNESS-V3 P1b). The regex decides which injected rows outlive a
 * compaction, so it gets positives AND near-misses; the numbers carry the reasoning in the policy
 * file's header, and the relations that reasoning depends on are pinned here.
 */

/** A row exactly as `injectCoachContext` (ai/aim.ts) writes it. */
const injected = (source: string, body = 'x') =>
  `<context source="${source}" version="1" built_at="2026-10-31T08:00:00.000Z">\n${body}\n</context>`;

describe('KEEP_NEWEST_CONTEXT', () => {
  it.each([
    [injected('date'), 'date'],
    [injected('attachments', 'Attached to this message:\n- photo_ref p-1'), 'attachments'],
    [injected('health-digest'), 'health-digest'],
    [`\n  ${injected('date')}`, 'date'],
  ])('keeps the newest of %j (source %s)', (row, source) => {
    expect(KEEP_NEWEST_CONTEXT.exec(row)?.[1]).toBe(source);
  });

  it.each([
    ['per-turn context (sent again every turn)', injected('turn-context')],
    ['a per-turn floor block', injected('turn-floor')],
    ['a failed attachment (nothing to refer back to)', injected('attachments-failed')],
    ['a goal-screen note', injected('goal-screen')],
    ['a pinned block (kept by pinnedRowPattern instead)', injected('registry-pack')],
    ['a similar source name', injected('dates')],
    ['a note', '<note>They shared Apple Health.</note>'],
    ['a user message that mentions the tag', 'I pasted <context source="date"> by accident'],
  ])('near-miss: %s', (_name, row) => {
    expect(KEEP_NEWEST_CONTEXT.test(row)).toBe(false);
  });

  it('every kept-newest row is an app row (so it is never summarized) and none is pinned', () => {
    for (const source of KEEP_NEWEST_CONTEXT_SOURCES) {
      expect(APP_AUTHORED.test(injected(source))).toBe(true);
      expect(PINNED_CONTEXT.test(injected(source))).toBe(false);
    }
  });

  it('the writers still use these source names', () => {
    const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
    expect(read('./date-context.ts')).toContain("source: 'date'");
    expect(read('./coach-attach-turn.ts')).toMatch(/'attachments'/);
    expect(read('../routes/health-digest.ts')).toContain("source: 'health-digest'");
  });
});

describe('COACH_SUMMARIZER', () => {
  it('is a policy the engine reads, with every pattern handed over as source', () => {
    const policy: SummarizerConfig = COACH_SUMMARIZER;
    expect(policy.appRowPattern).toBe(APP_AUTHORED.source);
    expect(policy.pinnedRowPattern).toBe(PINNED_CONTEXT.source);
    expect(policy.keepNewestRowPattern).toBe(KEEP_NEWEST_CONTEXT.source);
  });

  it('the guard sits under the gap between trigger and ceiling, so an after-reply run clears it first', () => {
    expect(COACH_SUMMARIZER.minRemovedUnits).toBeLessThan(
      COACH_SUMMARIZER.ceilingTokens - COACH_SUMMARIZER.triggerTokens,
    );
  });

  it('a full tail plus the fixed part (~8k units) leaves room to grow before the trigger', () => {
    expect(8_000 + COACH_SUMMARIZER.keepTailUnits).toBeLessThan(COACH_SUMMARIZER.triggerTokens / 2);
  });
});
