import { COACH_PICKS_FENCE } from '@cadence/shared';
import { chatProgress, livePicks, viewTurns } from './coachTurns.ts';
import type { CoachTurn } from './useCoachChat.ts';

const withPicks = (prose: string, json: object) =>
  `${prose}\n\`\`\`${COACH_PICKS_FENCE}\n${JSON.stringify(json)}\n\`\`\``;

const GOALS = { multi: true, progress: 0.2, options: [{ label: 'Run a first 10k' }] };
const MINUTES = { progress: 0.55, options: [{ label: '20', hint: 'most people keep this' }] };

describe('viewTurns', () => {
  it('strips the pick block out of what gets rendered', () => {
    const turns: CoachTurn[] = [{ role: 'coach', text: withPicks('What would you like to work on?', GOALS) }];
    const [view] = viewTurns(turns);
    expect(view?.text).toBe('What would you like to work on?');
    expect(view?.picks?.options).toHaveLength(1);
  });

  it('leaves user turns alone', () => {
    expect(viewTurns([{ role: 'user', text: '```not a block```' }])).toEqual([
      { role: 'user', text: '```not a block```', picks: null },
    ]);
  });
});

describe('livePicks', () => {
  it("offers only the newest question's picks", () => {
    const views = viewTurns([
      { role: 'coach', text: withPicks('One?', GOALS) },
      { role: 'user', text: 'run a first 10k' },
      { role: 'coach', text: withPicks('Two?', MINUTES) },
    ]);
    expect(livePicks(views, false)?.options[0]?.label).toBe('20');
  });

  it('offers nothing while the turn is still streaming', () => {
    const views = viewTurns([{ role: 'coach', text: withPicks('One?', GOALS) }]);
    expect(livePicks(views, true)).toBeNull();
  });

  it("offers nothing when the last word was the user's", () => {
    const views = viewTurns([
      { role: 'coach', text: withPicks('One?', GOALS) },
      { role: 'user', text: 'run a first 10k' },
    ]);
    expect(livePicks(views, false)).toBeNull();
  });
});

describe('chatProgress', () => {
  it('takes the most recent number the coach gave', () => {
    const views = viewTurns([
      { role: 'coach', text: withPicks('One?', GOALS) },
      { role: 'coach', text: withPicks('Two?', MINUTES) },
    ]);
    expect(chatProgress(views)).toBe(0.55);
  });

  it('holds the last number through turns that carry none — a follow-up is not a step back', () => {
    const views = viewTurns([
      { role: 'coach', text: withPicks('Two?', MINUTES) },
      { role: 'user', text: '3 days' },
      { role: 'coach', text: 'Nice — how did that go last time?' },
    ]);
    expect(chatProgress(views)).toBe(0.55);
  });

  it('is zero before the coach has said anything about it', () => {
    expect(chatProgress(viewTurns([{ role: 'coach', text: 'Hi.' }]))).toBe(0);
  });
});
