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

  it('adds the first-conversation script only for onboarding', () => {
    expect(renderPickProtocol({ intent: 'onboarding' })).toContain('FIRST CONVERSATION');
    expect(renderPickProtocol({ intent: 'ongoing' })).not.toContain('FIRST CONVERSATION');
    expect(renderPickProtocol()).not.toContain('FIRST CONVERSATION');
  });
});
