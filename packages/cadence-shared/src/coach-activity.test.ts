import { describe, it, expect } from 'vitest';
import { coachActivityLine, resolveActivityNames, ALL_PHRASE_KEYS } from './coach-activity.ts';

/**
 * Owner: *"they usually tell me when they're calling a tool. This would help us diagnose and it
 * would also tell the user something is happening (or happened)."*
 */
describe('coachActivityLine', () => {
  it('says what she is doing in the user’s terms', () => {
    expect(coachActivityLine(['get_workout_history'])).toBe('checking your recorded workouts');
    expect(coachActivityLine(['log_session'])).toBe('writing that down');
  });

  /** BRAND.md: the machinery stays hidden — to the user there is only the coach. */
  it('never leaks a tool name or the harness', () => {
    for (const n of ['find_tools', 'use_tool', 'get_nutrition', 'propose_plan_change']) {
      const line = coachActivityLine([n]);
      expect(line).not.toContain('_');
      expect(line).not.toMatch(/tool|function|harness/i);
    }
  });

  /** A queue of activity reads as a machine working, and she is not a machine to this person. */
  it('collapses several calls to one line', () => {
    expect(coachActivityLine(['get_active_plan', 'get_workout_history'])).toBe('looking at your plan');
  });

  it('still says something true for a tool nobody wrote a phrase for', () => {
    expect(coachActivityLine(['get_something_new'])).toBe('looking something up');
    expect(coachActivityLine([])).toBe('looking something up');
  });
});

/**
 * The unwrap (2026-08-21).
 *
 * The phrase table was specific from the day it shipped, and the owner still saw "looking something
 * up" for nearly everything — twice reporting it. The reason: most reads reach their tool THROUGH
 * `use_tool`, so the name on the wire was the meta-tool and the specificity was discarded one layer
 * before the screen.
 *
 * These test the RESOLUTION, not the phrasing. The last time this feature shipped dead, every test
 * asserted the words and none asserted that the words could reach a user — "a unit test on the
 * words is not a test that the words are visible" (PLAN.md, 2026-08-17). So each case here goes
 * end to end: the call as it arrives off the wire, through to the line a person would read.
 */
describe('resolveActivityNames — seeing through use_tool', () => {
  const line = (calls: Array<{ name: string; arguments?: string | null }>) =>
    coachActivityLine(resolveActivityNames(calls));

  it('names the tool use_tool is actually running', () => {
    expect(line([{ name: 'use_tool', arguments: '{"name":"get_nutrition"}' }])).toBe('checking your food');
  });

  it('the bug, stated as a test: this used to say "looking something up"', () => {
    expect(line([{ name: 'use_tool', arguments: '{"name":"get_workout_history"}' }])).toBe(
      'checking your recorded workouts',
    );
  });

  it('leaves a directly-called tool alone', () => {
    expect(line([{ name: 'log_session', arguments: '{}' }])).toBe('writing that down');
  });

  it('find_tools says what it is really doing — reading the menu, not the meal', () => {
    expect(line([{ name: 'find_tools', arguments: '{"query":"workouts"}' }])).toBe('looking up what I can check');
  });

  /** A status line must never be the thing that throws. */
  it.each([
    ['malformed json', 'not json at all'],
    ['missing name', '{"query":"x"}'],
    ['empty', ''],
    ['null', null],
  ])('degrades to the honest generic line on %s', (_label, args) => {
    expect(line([{ name: 'use_tool', arguments: args as string | null }])).toBe('looking something up');
  });

  it('an unmapped inner tool still says something true', () => {
    expect(line([{ name: 'use_tool', arguments: '{"name":"get_something_new"}' }])).toBe('looking something up');
  });
});

/**
 * The coach speaks as "I" (BRAND.md). A status line reading "looking up what SHE can check" is the
 * app narrating her from outside — a different voice from the one writing every other sentence on
 * screen. Shipped 2026-08-21 and spotted by the owner the same day; this stops it coming back.
 */
describe('voice', () => {
  it('never refers to the coach in the third person', () => {
    const thirdPerson = /\b(she|her|hers|he|him|his|they|their|theirs|the coach|cadence)\b/i;
    for (const name of ALL_PHRASE_KEYS) {
      const line = coachActivityLine([name]);
      expect(line, `${name}: "${line}"`).not.toMatch(thirdPerson);
    }
  });

  it('reads as work in progress, not a status code', () => {
    for (const name of ALL_PHRASE_KEYS) {
      // Present participle: every line is something being done right now.
      expect(coachActivityLine([name]), name).toMatch(/ing\b/);
    }
  });
});
