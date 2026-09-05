import { describe, expect, it } from 'vitest';
import { classifyFreshness, ctxMarker, renderContextBlock } from './turn-context-memory.ts';

const HEALTH = 'Recent activity (Apple Health, last 90 days): 14 workouts, ~1.1/week overall.';
const HEALTH_LATER = 'Recent activity (Apple Health, last 90 days): 15 workouts, ~1.2/week overall.';

/**
 * Reported: Cadence read the same Apple Health summary back three times in one conversation,
 * reworded slightly each time. The cause was not memory loss and not the re-injection itself —
 * re-injection is what keeps the dossier alive across a long chat and session compaction, and must
 * continue. It was that every block announced itself as "Fetched for this turn", so identical data
 * looked like news every time it arrived.
 */
describe('classifyFreshness', () => {
  it('is new the first time a function appears', () => {
    expect(classifyFreshness('', 'get_health_history', HEALTH)).toBe('new');
    expect(classifyFreshness('[ctx:get_identity:abc123] Jamie', 'get_health_history', HEALTH)).toBe('new');
  });

  it('is unchanged when the very same content comes round again', () => {
    const history = `${ctxMarker('get_health_history', HEALTH)} ${HEALTH}`;
    expect(classifyFreshness(history, 'get_health_history', HEALTH)).toBe('unchanged');
  });

  it('is changed when the same function returns different data', () => {
    const history = `${ctxMarker('get_health_history', HEALTH)} ${HEALTH}`;
    expect(classifyFreshness(history, 'get_health_history', HEALTH_LATER)).toBe('changed');
  });

  it('ignores whitespace-only differences, which are not a change worth announcing', () => {
    const history = `${ctxMarker('get_health_history', HEALTH)} ${HEALTH}`;
    expect(classifyFreshness(history, 'get_health_history', `  ${HEALTH}\n`)).toBe('unchanged');
  });
});

describe('renderContextBlock', () => {
  it('tells her plainly not to react to what she already has', () => {
    const block = renderContextBlock(
      [{ fn: 'get_health_history', rendered: HEALTH, freshness: 'unchanged' }],
      'user mentioned training',
    );
    expect(block).toContain('UNCHANGED since you last saw it');
    expect(block).toMatch(/Do NOT restate it uninvited/);
    // Facts, not picks (owner 2026-09-03): the old heading forbade reacting at all, with no way
    // back for a user who asks to hear it. The escape hatch the 'changed' heading has is here too.
    expect(block).not.toContain('ALREADY YOURS');
    expect(block).not.toMatch(/react to it again/);
    expect(block).toMatch(/if they ask to hear something in full, read it back whole/);
    // The data is still THERE — that is the point; dropping it is what loses her memory.
    expect(block).toContain(HEALTH);
  });

  it('flags a real change as worth acknowledging', () => {
    const block = renderContextBlock([{ fn: 'get_weight', rendered: '195 lbs', freshness: 'changed' }], '');
    expect(block).toContain('CHANGED since you last saw it.');
    // The heading states the fact; how much to say about the delta is hers.
    expect(block).not.toMatch(/briefly acknowledge what actually differs/);
  });

  it('groups by freshness so each heading is honest about its own data', () => {
    const block = renderContextBlock(
      [
        { fn: 'get_health_history', rendered: HEALTH, freshness: 'unchanged' },
        { fn: 'get_constraints', rendered: 'left knee — plan around it', freshness: 'new' },
      ],
      'user mentioned an injury',
    );
    // Changed first, then new, then the quiet reminder — the order she should read them in.
    expect(block.indexOf('New to you this turn')).toBeLessThan(block.indexOf('UNCHANGED since you last saw it'));
    expect(block).toContain('get_constraints');
    expect(block).toContain('user mentioned an injury');
  });

  it('carries a marker per function so the next turn can compare', () => {
    const block = renderContextBlock([{ fn: 'get_health_history', rendered: HEALTH, freshness: 'new' }], '');
    expect(block).toContain(ctxMarker('get_health_history', HEALTH));
    expect(classifyFreshness(block, 'get_health_history', HEALTH)).toBe('unchanged');
  });
});

/**
 * Regression, reported twice from the device: Cadence read the user's Apple Health summary back to
 * them, then read it back AGAIN a couple of turns later, reworded.
 *
 * The first fix covered turn-to-turn repetition and missed the route it actually arrives by. The
 * SESSION-OPEN pack (context-pack.ts) is the very first thing she is told, and it was emitting no
 * `[ctx:fn:hash]` markers at all — so when a later turn retrieved the same health history, the
 * lookback found nothing, classified it `new`, and she announced it as news a second time.
 *
 * These assert the contract BETWEEN the two producers: whatever the pack puts in front of her must
 * be recognisable to the turn path as already-seen. A marker is only worth anything if both ends
 * agree on it.
 */
describe('the pack and the turn path must agree', () => {
  const HEALTH_RENDER = 'Recent activity: 10 runs, longest 6.5 km, 5 in the last 28 days.';

  it('a marker emitted at session open makes the same data unchanged on a later turn', () => {
    // What context-pack.ts now appends: markers on their own line, computed from f.render(result).
    const packBlock = `[context built 2026-08-12 · deterministic · fns: get_health_history]\n\nSome Broker-rewritten prose that shares no words with the render.\n\n${ctxMarker('get_health_history', HEALTH_RENDER)}`;

    expect(classifyFreshness(packBlock, 'get_health_history', HEALTH_RENDER)).toBe('unchanged');
  });

  it('without the pack marker it reads as new — the bug, pinned', () => {
    const packWithoutMarkers = '[context built 2026-08-12]\n\nRecent activity: 10 runs, longest 6.5 km.';
    expect(classifyFreshness(packWithoutMarkers, 'get_health_history', HEALTH_RENDER)).toBe('new');
  });

  it('still notices when the data genuinely moved on', () => {
    const packBlock = ctxMarker('get_health_history', HEALTH_RENDER);
    const afterAnotherRun = 'Recent activity: 11 runs, longest 6.5 km, 6 in the last 28 days.';
    expect(classifyFreshness(packBlock, 'get_health_history', afterAnotherRun)).toBe('changed');
  });
});
