import { describe, expect, it } from 'vitest';
import { COACH_PICKS_FENCE, OPENING_QUESTION, parseCoachTurn } from '@cadence/shared';
import { renderPickProtocol } from './coach-picks-protocol.ts';

describe('renderPickProtocol', () => {
  it('names the exact fence the client parser looks for', () => {
    expect(renderPickProtocol()).toContain(COACH_PICKS_FENCE);
  });

  it('ships an example the shared parser can actually read', () => {
    // The example is the only concrete shape the model sees, so a drift between it and the parser
    // is a coach emitting blocks the client silently drops.
    const example = renderPickProtocol().split('Example turn:')[1] ?? '';
    const parsed = parseCoachTurn(example);
    expect(parsed.picks?.layout).toBe('list');
    expect(parsed.picks?.multi).toBe(true);
    expect(parsed.picks?.lead).toBe("I'd like to");
    expect(parsed.picks?.options).toHaveLength(4);
  });

  it('quotes the opening question verbatim so the coach never asks it twice', () => {
    // The app paints turn 1 itself and never sends it upstream, so the coach's only knowledge of
    // what was already asked is this quote. If the two drift, she re-asks it and the user answers
    // the same question twice.
    expect(renderPickProtocol({ intent: 'onboarding' })).toContain(OPENING_QUESTION);
  });

  it('tells the coach to default to picks rather than treating them as optional', () => {
    const out = renderPickProtocol({ intent: 'onboarding' });
    expect(out).toContain('DEFAULT TO PICKS');
    expect(out).toMatch(/TILES question/i);
  });

  /**
   * Owner ruling 2026-08-10: "how many days a week" is a fitness-app question, and Cadence is not
   * one — nobody eats well three days a week. Capacity is asked as where the room in the DAY is
   * and how long they have, so the plan can point at every day rather than three of them.
   */
  it('never asks for a weekly day count, and asks about the day instead', () => {
    const out = renderPickProtocol({ intent: 'onboarding' });
    expect(out).toContain('NEVER ask how many days a week');
    expect(out).toMatch(/What does your day usually look like\?/);
    expect(out).toMatch(/time do we have to work with/i);
    // The old tiles exemplar was the day-count question; it must not survive as an example either.
    expect(out).not.toMatch(/"How many days a week\?" is tiles/);
  });

  /**
   * The model echoes the phrasing it is given, so shorthand written for us leaks into her mouth as
   * clipped, unnatural questions. The script has to say so, and carry sayable examples.
   */
  it('tells the coach the notes are shorthand, not a script to read aloud', () => {
    expect(renderPickProtocol({ intent: 'onboarding' })).toContain('SAY IT LIKE A PERSON');
  });

  it('bounds the narrowing so intake cannot turn into an interrogation', () => {
    expect(renderPickProtocol({ intent: 'onboarding' })).toMatch(/One or two narrowing turns per goal/);
  });

  it('adds the first-conversation script only for onboarding', () => {
    expect(renderPickProtocol({ intent: 'onboarding' })).toContain('FIRST CONVERSATION');
    expect(renderPickProtocol({ intent: 'ongoing' })).not.toContain('FIRST CONVERSATION');
    expect(renderPickProtocol()).not.toContain('FIRST CONVERSATION');
  });
});
