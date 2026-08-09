import { describe, expect, it } from 'vitest';
import { COACH_PICKS_FENCE, coercePicks, composePickMessage, parseCoachTurn, type CoachPicks } from './coach-picks.ts';

const block = (json: string) => '```' + COACH_PICKS_FENCE + '\n' + json + '\n```';

const GOALS: CoachPicks = {
  layout: 'list',
  multi: true,
  lead: "I'd like to",
  options: [
    { label: 'Run a first 10k', say: 'run a first 10k', area: 'movement' },
    { label: 'Eat better', say: 'eat better', area: 'nourishment' },
    { label: 'A steadier mind', say: 'build a steadier mind', area: 'mind' },
  ],
};

describe('parseCoachTurn', () => {
  it('returns the turn untouched when there is no pick block', () => {
    expect(parseCoachTurn('So — what would you like to work on?')).toEqual({
      text: 'So — what would you like to work on?',
      picks: null,
    });
  });

  it('splits prose from the pick set', () => {
    const raw = `What would you like to work on?\n\n${block(JSON.stringify(GOALS))}`;
    const out = parseCoachTurn(raw);
    expect(out.text).toBe('What would you like to work on?');
    expect(out.picks?.options).toHaveLength(3);
    expect(out.picks?.multi).toBe(true);
  });

  it('keeps prose that follows the block', () => {
    const raw = `Pick any.\n${block(JSON.stringify(GOALS))}\nOr just tell me.`;
    expect(parseCoachTurn(raw).text).toBe('Pick any.\nOr just tell me.');
  });

  it('withholds a half-streamed block instead of painting raw JSON', () => {
    const raw = 'How many days?\n\n```' + COACH_PICKS_FENCE + '\n{"layout":"tiles","opt';
    expect(parseCoachTurn(raw)).toEqual({ text: 'How many days?', picks: null });
  });

  it('drops a malformed block rather than showing it', () => {
    const raw = `How many days?\n${block('{not json')}`;
    expect(parseCoachTurn(raw)).toEqual({ text: 'How many days?', picks: null });
  });

  it('tolerates a fence written with a leading space', () => {
    const raw = '``` ' + COACH_PICKS_FENCE + '\n' + JSON.stringify(GOALS) + '\n```';
    expect(parseCoachTurn(raw).picks?.layout).toBe('list');
  });
});

describe('coercePicks', () => {
  it("accepts a confirm block with no options — its content is the user's own data", () => {
    const picks = coercePicks({ layout: 'confirm', progress: 0.9 });
    expect(picks?.layout).toBe('confirm');
    expect(picks?.options).toEqual([]);
  });

  it('rejects a block with no usable options', () => {
    expect(coercePicks({ layout: 'list', options: [] })).toBeNull();
    expect(coercePicks({ layout: 'list', options: [{ hint: 'no label' }] })).toBeNull();
    expect(coercePicks({ layout: 'grid', options: [{ label: 'a' }] })).toBeNull();
    expect(coercePicks('nope')).toBeNull();
  });

  it('drops unusable options but keeps the rest', () => {
    const picks = coercePicks({ layout: 'list', options: [{ label: 'a' }, null, { label: '' }, { label: 'b' }] });
    expect(picks?.options.map((o) => o.label)).toEqual(['a', 'b']);
  });

  it('caps the option count so a turn can never become a form', () => {
    const options = Array.from({ length: 20 }, (_, i) => ({ label: `${i}` }));
    expect(coercePicks({ layout: 'tiles', options })?.options).toHaveLength(8);
  });

  it('clamps progress into 0–1 and ignores a non-numeric one', () => {
    expect(coercePicks({ layout: 'list', options: [{ label: 'a' }], progress: 4 })?.progress).toBe(1);
    expect(coercePicks({ layout: 'list', options: [{ label: 'a' }], progress: -1 })?.progress).toBe(0);
    expect(coercePicks({ layout: 'list', options: [{ label: 'a' }], progress: 'half' })?.progress).toBeUndefined();
  });

  it('defaults multi to false — one answer unless the coach says otherwise', () => {
    expect(coercePicks({ layout: 'tiles', options: [{ label: '3' }] })?.multi).toBe(false);
  });

  it('keeps only recognised areas', () => {
    const picks = coercePicks({
      layout: 'list',
      options: [
        { label: 'a', area: 'weight' },
        { label: 'b', area: 'mind' },
      ],
    });
    expect(picks?.options[0]?.area).toBeUndefined();
    expect(picks?.options[1]?.area).toBe('mind');
  });
});

describe('composePickMessage', () => {
  it('speaks a multi-selection the way a person would', () => {
    expect(composePickMessage(GOALS, [0, 2])).toBe("I'd like to run a first 10k and build a steadier mind.");
    expect(composePickMessage(GOALS, [0, 1, 2])).toBe(
      "I'd like to run a first 10k, eat better and build a steadier mind.",
    );
  });

  it('orders by the option list, not by tap order', () => {
    expect(composePickMessage(GOALS, [2, 0])).toBe(composePickMessage(GOALS, [0, 2]));
  });

  it('uses a scalar say verbatim when there is no lead', () => {
    const days: CoachPicks = {
      layout: 'tiles',
      multi: false,
      options: [{ label: '3', say: '3 days a week feels right.', hint: 'most people keep this' }],
    };
    expect(composePickMessage(days, [0])).toBe('3 days a week feels right.');
  });

  it('falls back to the label when an option has no say', () => {
    expect(composePickMessage({ layout: 'list', multi: false, options: [{ label: 'Mornings' }] }, [0])).toBe(
      'Mornings',
    );
  });

  it('is empty for an empty selection, which is what keeps send inert', () => {
    expect(composePickMessage(GOALS, [])).toBe('');
  });
});
