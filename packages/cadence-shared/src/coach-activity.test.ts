import { describe, it, expect } from 'vitest';
import { coachActivityLine } from './coach-activity.ts';

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
