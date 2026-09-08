/**
 * The header's one quiet line is a router — which sentence it picks decides what the user is
 * told — so it gets a table (owner, 2026-09-01: every deterministic router ships with one).
 */
import { GROUP_HINT, windowLine } from './windowLine.ts';

const until = 'adds until 11:02';

describe('windowLine', () => {
  it.each([
    // loose, logged, empty, addsUntil → line
    [2, false, false, until, GROUP_HINT],
    [2, false, false, null, GROUP_HINT],
    [3, true, false, null, GROUP_HINT],
    [1, false, false, until, until],
    [0, false, false, until, until],
    [0, false, true, until, `${until} · nothing in it yet`],
    [0, false, true, null, 'nothing in it yet'],
    // Logged with nothing to group: the LOGGED chip already says it — no line at all.
    [0, true, false, null, ''],
    [1, true, false, null, ''],
  ] as const)('loose=%s logged=%s empty=%s until=%s → "%s"', (loose, logged, empty, addsUntil, line) => {
    expect(windowLine({ loose, logged, empty, addsUntil })).toBe(line);
  });

  it('never says "counts right away" — the line that added nothing (owner, 2026-09-08)', () => {
    expect(windowLine({ loose: 0, logged: true, empty: false, addsUntil: null })).not.toMatch(/counts/);
  });
});
