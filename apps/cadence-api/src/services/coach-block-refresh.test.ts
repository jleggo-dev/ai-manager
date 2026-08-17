import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The blocks a session is born with, and why they have to be able to change under it.
 *
 * The capability manifest and the pick protocol ship in code so they can be FIXED in a deploy. They
 * were injected once, at session open, and `STALE_IDLE_MS` is seven days — so a session that opened
 * on the 15th argued from the 15th's text for a week. Both 2026-08-16 fixes for "she promises a
 * plan change and never calls the tool" landed in a build the owner's live session never read.
 *
 * These tests pin the three things that make re-injection safe rather than just possible: it costs
 * nothing when nothing changed, it never contradicts itself when something did, and it cannot take
 * a turn down with it.
 */

const getCoachHistory = vi.fn();
const injectCoachContext = vi.fn();

vi.mock('../ai/aim.ts', () => ({
  getCoachHistory: (...a: unknown[]) => getCoachHistory(...a),
  injectCoachContext: (...a: unknown[]) => injectCoachContext(...a),
}));

// The renderers are REAL here on purpose: the whole mechanism is a comparison against what this
// build actually renders, and a stubbed renderer would test the comparison against nothing.
const { injectCoachBlocks, refreshChangedBlocks, parseContextTurn, supersedeHeader, __resetCoachBlockRefreshForTests } =
  await import('./coach-block-refresh.ts');
type CoachBlockOpts = Parameters<typeof injectCoachBlocks>[2];

/** How `injectCoachContext` wraps a block. `built_at` is a parameter here because it is the point. */
const wrap = (source: string, body: string, builtAt = '2026-08-15T09:00:00.000Z', version = 2) =>
  `<context source="${source}" version="${version}" built_at="${builtAt}">\n${body}\n</context>`;

/** Every `injectCoachContext` call so far, as `{ source: body }`. */
function injected(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const call of injectCoachContext.mock.calls) {
    out[String((call[3] as { source?: string })?.source)] = String(call[2]);
  }
  return out;
}

/**
 * What session open hands out for these options — which is, by construction, the only text a
 * refresh will accept as current. Leaves the memo cleared so the caller can then run a refresh.
 */
async function bodiesAtOpen(opts: CoachBlockOpts = { healthAvailable: true }): Promise<Record<string, string>> {
  injectCoachContext.mockClear();
  await injectCoachBlocks('u1', 'sess-open', opts);
  const bodies = injected();
  injectCoachContext.mockClear();
  __resetCoachBlockRefreshForTests();
  return bodies;
}

/** A session history holding one `<context>` turn per source, plus a couple of real turns. */
const historyOf = (bodies: Record<string, string>, builtAt?: string) => ({
  messages: [
    { role: 'user', content: 'I want to run a 10k' },
    ...Object.entries(bodies).map(([source, body]) => ({ role: 'user', content: wrap(source, body, builtAt) })),
    { role: 'assistant', content: 'Good — when do you run?' },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetCoachBlockRefreshForTests();
  injectCoachContext.mockResolvedValue(undefined);
  getCoachHistory.mockResolvedValue({ messages: [] });
});

describe('re-injecting a block whose text changed under a live session', () => {
  /** THE bug: the owner's session, still carrying the pre-fix text a day after the fix shipped. */
  it("re-injects both blocks when the session is holding last week's text", async () => {
    getCoachHistory.mockResolvedValue(
      historyOf({
        capabilities: '== WHAT CADENCE CAN DO ==\nTalking and remembering: talk through what you are building.',
        'pick-protocol': '== QUICK PICKS ==\ncall the propose_plan_change tool, then emit layout "change".',
      }),
    );

    expect(await refreshChangedBlocks('u1', 'sess-live')).toEqual(['capabilities', 'pick-protocol']);

    const now = injected();
    // The two lines that never reached him.
    expect(now.capabilities).toContain('DO THESE, DO NOT DESCRIBE THEM');
    expect(now['pick-protocol']).toContain('it needs nothing further from you');
    expect(now['pick-protocol']).not.toMatch(/emit layout "change"/i);
  });

  it("does NOT re-inject when the session is already holding this build's text", async () => {
    getCoachHistory.mockResolvedValue(historyOf(await bodiesAtOpen()));

    expect(await refreshChangedBlocks('u1', 'sess-current')).toEqual([]);
    expect(injectCoachContext).not.toHaveBeenCalled();
  });

  /**
   * `built_at` is stamped fresh on every injection, so comparing the wrapper would re-send ~1.7k
   * tokens every single turn — the exact cost this mechanism exists to avoid. Only the body counts.
   */
  it('ignores a built_at (or a version) that differs while the content does not', async () => {
    const bodies = await bodiesAtOpen();
    getCoachHistory.mockResolvedValue({
      messages: [
        { role: 'user', content: wrap('capabilities', bodies.capabilities!, '2019-01-01T00:00:00.000Z', 1) },
        { role: 'user', content: wrap('pick-protocol', bodies['pick-protocol']!, '2031-12-31T23:59:59.000Z', 99) },
      ],
    });

    expect(await refreshChangedBlocks('u1', 'sess-restamped')).toEqual([]);
    expect(injectCoachContext).not.toHaveBeenCalled();
  });

  it('compares against the LAST block per source, not the first', async () => {
    const bodies = await bodiesAtOpen();
    getCoachHistory.mockResolvedValue({
      messages: [
        { role: 'user', content: wrap('capabilities', 'ancient text') },
        { role: 'user', content: wrap('pick-protocol', 'ancient text') },
        // A refresh that already happened earlier in this session's life.
        { role: 'user', content: wrap('capabilities', bodies.capabilities!) },
        { role: 'user', content: wrap('pick-protocol', bodies['pick-protocol']!) },
      ],
    });

    expect(await refreshChangedBlocks('u1', 'sess-refreshed-once')).toEqual([]);
  });

  /** Absence is not staleness. Nothing in the history says which device or which intent it was. */
  it('leaves a session that never received a block alone rather than guessing its variant', async () => {
    getCoachHistory.mockResolvedValue({ messages: [{ role: 'user', content: 'hello' }] });

    expect(await refreshChangedBlocks('u1', 'sess-blockless')).toEqual([]);
    expect(injectCoachContext).not.toHaveBeenCalled();
  });
});

describe('the refreshed block supersedes rather than contradicts', () => {
  /**
   * Re-injection does not delete the old block — both sit in the history and both reach the model.
   * The failure mode being guarded is a rule that exists ONLY in the old copy (emit layout
   * "change") being read as an extra step that still stands.
   */
  it('opens by naming its own source and withdrawing anything only the older copy says', async () => {
    getCoachHistory.mockResolvedValue(historyOf({ capabilities: 'old', 'pick-protocol': 'old' }));
    await refreshChangedBlocks('u1', 'sess-live');

    for (const source of ['capabilities', 'pick-protocol']) {
      const body = injected()[source]!;
      expect(body.startsWith(supersedeHeader(source))).toBe(true);
      expect(body).toContain(`SUPERSEDES ANY EARLIER "${source}" BLOCK`);
      expect(body).toContain(`source="${source}"`);
      expect(body).toMatch(/follow this one wherever they differ/);
      expect(body).toMatch(/ONLY in the older copy as withdrawn, not as an extra rule/);
    }
  });

  /** The same words at session open, where there is no earlier copy — and it has to be the same
   *  words, because the refresh recognises "unchanged" by exact match against what open sends. */
  it('says it at session open too, so the two paths produce identical text', async () => {
    const bodies = await bodiesAtOpen({ healthAvailable: true, intent: 'onboarding' });
    expect(bodies.capabilities!.startsWith(supersedeHeader('capabilities'))).toBe(true);
    expect(bodies['pick-protocol']!.startsWith(supersedeHeader('pick-protocol'))).toBe(true);
  });

  /** A refresh that re-injects a body the next check would reject again is an infinite bill. */
  it('injects only text a later check reads back as current', async () => {
    getCoachHistory.mockResolvedValue(historyOf({ capabilities: 'old', 'pick-protocol': 'old' }));
    await refreshChangedBlocks('u1', 'sess-live');
    const first = injected();

    injectCoachContext.mockClear();
    __resetCoachBlockRefreshForTests();
    getCoachHistory.mockResolvedValue(historyOf(first));

    expect(await refreshChangedBlocks('u1', 'sess-live')).toEqual([]);
  });
});

describe('the refresh keeps the variant the session was opened with', () => {
  /**
   * The message path knows nothing about the device or the session's intent — only the block does.
   * Guessing wrong is a real regression in both directions: an iPhone told Apple Health is
   * unavailable (the bug fixed on 2026-08-15), or an onboarding session losing its running order.
   */
  it('keeps a no-Apple-Health session on the no-Apple-Health text', async () => {
    getCoachHistory.mockResolvedValue(
      historyOf({ capabilities: 'stale text\nNot on this device: Apple Health — do not offer to read it here.' }),
    );
    await refreshChangedBlocks('u1', 'sess-web');

    expect(injected().capabilities).toContain('Not on this device: Apple Health');
  });

  it('keeps a phone reading Apple Health itself', async () => {
    getCoachHistory.mockResolvedValue(historyOf({ capabilities: 'stale text with no device line' }));
    await refreshChangedBlocks('u1', 'sess-ios');

    expect(injected().capabilities).toContain('Apple Health: you READ IT YOURSELF');
  });

  it('keeps a session mid-onboarding on the first-conversation script', async () => {
    getCoachHistory.mockResolvedValue(
      historyOf({ 'pick-protocol': 'stale\n== FIRST CONVERSATION — a suggested running order ==\n1. old' }),
    );
    await refreshChangedBlocks('u1', 'sess-onboarding');

    expect(injected()['pick-protocol']).toContain('FIRST CONVERSATION');
  });

  it('does not hand the onboarding script to an ongoing conversation', async () => {
    getCoachHistory.mockResolvedValue(historyOf({ 'pick-protocol': 'stale ongoing protocol' }));
    await refreshChangedBlocks('u1', 'sess-ongoing');

    expect(injected()['pick-protocol']).not.toContain('FIRST CONVERSATION');
  });

  /**
   * The variant list is the closed set a refresh may inject from AND the candidate list an existing
   * block is matched against. If a renderer grows a branch nobody added a variant for, a session
   * opened on that branch would be re-injected on every single turn, forever. This is the guard.
   */
  it('renders every option combination as one of the known variants', async () => {
    for (const intent of [undefined, 'onboarding', 'initial', 'ongoing', 'disrupted']) {
      for (const healthAvailable of [undefined, true, false]) {
        for (const healthAnswered of [undefined, true, false]) {
          const bodies = await bodiesAtOpen({ intent, healthAvailable, healthAnswered });
          getCoachHistory.mockResolvedValue(historyOf(bodies));
          const refreshed = await refreshChangedBlocks('u1', `sess-${intent}-${healthAvailable}-${healthAnswered}`);
          expect(
            refreshed,
            `unmatched variant for ${JSON.stringify({ intent, healthAvailable, healthAnswered })}`,
          ).toEqual([]);
        }
      }
    }
  });
});

describe('what an unchanged session costs', () => {
  /** ~6.5KB of blocks, on every turn, for a week — the reason this is gated at all. */
  it('reads history once per session and never again while the text stands', async () => {
    getCoachHistory.mockResolvedValue(historyOf(await bodiesAtOpen()));

    await refreshChangedBlocks('u1', 'sess-hot');
    await refreshChangedBlocks('u1', 'sess-hot');
    await refreshChangedBlocks('u1', 'sess-hot');

    expect(getCoachHistory).toHaveBeenCalledTimes(1);
    expect(injectCoachContext).not.toHaveBeenCalled();
  });

  it('skips the read entirely for a session opened in this process', async () => {
    await injectCoachBlocks('u1', 'sess-fresh', { healthAvailable: true });
    injectCoachContext.mockClear();

    expect(await refreshChangedBlocks('u1', 'sess-fresh')).toEqual([]);
    expect(getCoachHistory).not.toHaveBeenCalled();
  });

  it("does not let one session's verdict stand in for another's", async () => {
    getCoachHistory.mockResolvedValue(historyOf(await bodiesAtOpen()));
    await refreshChangedBlocks('u1', 'sess-a');
    await refreshChangedBlocks('u2', 'sess-b');

    expect(getCoachHistory).toHaveBeenCalledTimes(2);
  });
});

describe('a fault here never costs anybody their reply', () => {
  it('swallows a history read that blows up, and re-checks on the next turn', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    getCoachHistory.mockRejectedValue(new Error('AI Admin went away'));

    await expect(refreshChangedBlocks('u1', 'sess-broken')).resolves.toEqual([]);
    expect(injectCoachContext).not.toHaveBeenCalled();

    // A failed check must NOT mark the session current — that would strand it on the old text.
    await refreshChangedBlocks('u1', 'sess-broken');
    expect(getCoachHistory).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it('swallows a failed injection rather than throwing into the turn', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    getCoachHistory.mockResolvedValue(historyOf({ capabilities: 'old', 'pick-protocol': 'old' }));
    injectCoachContext.mockRejectedValue(new Error('write failed'));

    await expect(refreshChangedBlocks('u1', 'sess-unwritable')).resolves.toEqual([]);
    err.mockRestore();
  });

  it('survives history in whatever shape it comes back in', async () => {
    for (const hist of [{}, { messages: null }, { data: [{ role: 'user' }] }, { messages: [{ content: null }] }]) {
      __resetCoachBlockRefreshForTests();
      getCoachHistory.mockResolvedValue(hist);
      await expect(refreshChangedBlocks('u1', 'sess-odd')).resolves.toEqual([]);
    }
  });
});

describe('parseContextTurn', () => {
  it('reads the source and body out of an injected block', () => {
    expect(parseContextTurn(wrap('capabilities', 'line one\nline two'))).toEqual({
      source: 'capabilities',
      body: 'line one\nline two',
    });
  });

  it('is not fooled by a user turn, a note, or a half-written wrapper', () => {
    expect(parseContextTurn('I want to run a 10k')).toBeNull();
    expect(parseContextTurn('<note>they just shared Apple Health</note>')).toBeNull();
    expect(parseContextTurn('<context version="2">no source</context>')).toBeNull();
    expect(parseContextTurn('<context source="capabilities">unterminated')).toBeNull();
  });
});
