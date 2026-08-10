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
    expect(block).toContain('ALREADY YOURS, UNCHANGED');
    expect(block).toMatch(/Do NOT summarise, restate or react to it again/);
    // The data is still THERE — that is the point; dropping it is what loses her memory.
    expect(block).toContain(HEALTH);
  });

  it('flags a real change as worth acknowledging', () => {
    const block = renderContextBlock([{ fn: 'get_weight', rendered: '195 lbs', freshness: 'changed' }], '');
    expect(block).toContain('CHANGED since you last saw it');
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
    expect(block.indexOf('New to you this turn')).toBeLessThan(block.indexOf('ALREADY YOURS'));
    expect(block).toContain('get_constraints');
    expect(block).toContain('user mentioned an injury');
  });

  it('carries a marker per function so the next turn can compare', () => {
    const block = renderContextBlock([{ fn: 'get_health_history', rendered: HEALTH, freshness: 'new' }], '');
    expect(block).toContain(ctxMarker('get_health_history', HEALTH));
    expect(classifyFreshness(block, 'get_health_history', HEALTH)).toBe('unchanged');
  });
});
