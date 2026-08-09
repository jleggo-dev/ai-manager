import { describe, expect, it } from 'vitest';
import { COACH_PICKS_FENCE, parseCoachTurn } from '@cadence/shared';
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

  it('adds the first-conversation script only for onboarding', () => {
    expect(renderPickProtocol({ intent: 'onboarding' })).toContain('FIRST CONVERSATION');
    expect(renderPickProtocol({ intent: 'ongoing' })).not.toContain('FIRST CONVERSATION');
    expect(renderPickProtocol()).not.toContain('FIRST CONVERSATION');
  });
});
