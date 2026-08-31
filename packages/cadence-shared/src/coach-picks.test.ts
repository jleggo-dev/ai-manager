import { describe, expect, it } from 'vitest';
import { COACH_PICKS_FENCE, coercePicks, composePickMessage, parseCoachTurn, type CoachPicks } from './coach-picks.ts';

const block = (json: string) => '```' + COACH_PICKS_FENCE + '\n' + json + '\n```';

const GOALS: CoachPicks = {
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
    const raw = 'How many days?\n\n```' + COACH_PICKS_FENCE + '\n{"multi":false,"opt';
    expect(parseCoachTurn(raw)).toEqual({ text: 'How many days?', picks: null });
  });

  it('drops a malformed block rather than showing it', () => {
    const raw = `How many days?\n${block('{not json')}`;
    expect(parseCoachTurn(raw)).toEqual({ text: 'How many days?', picks: null });
  });

  it('tolerates a fence written with a leading space', () => {
    const raw = '``` ' + COACH_PICKS_FENCE + '\n' + JSON.stringify(GOALS) + '\n```';
    expect(parseCoachTurn(raw).picks?.options).toHaveLength(3);
  });

  /**
   * A turn that ran tools can carry text from more than one generation, each ending in its own
   * block. Extracting only the first painted the second as raw JSON on the phone (2026-08-31) —
   * every block is stripped, and the LAST valid one is the turn's pick set.
   */
  it('strips every block in a multi-block turn and keeps the last as the live picks', () => {
    const first: CoachPicks = { multi: false, options: [{ label: 'Morning' }, { label: 'Evening' }] };
    const second: CoachPicks = { multi: false, options: [{ label: 'Tuesday' }, { label: 'Friday' }] };
    const raw = `When works best?\n\n${block(JSON.stringify(first))}\nActually — which day?\n\n${block(JSON.stringify(second))}`;
    const out = parseCoachTurn(raw);
    expect(out.text).toBe('When works best?\nActually — which day?');
    expect(out.text).not.toContain('```');
    expect(out.picks?.options.map((o) => o.label)).toEqual(['Tuesday', 'Friday']);
  });

  it('keeps an earlier valid block when the last one is malformed', () => {
    const raw = `Pick one.\n${block(JSON.stringify(GOALS))}\n${block('{not json')}`;
    const out = parseCoachTurn(raw);
    expect(out.text).toBe('Pick one.');
    expect(out.picks?.options).toHaveLength(3);
  });

  it('withholds a half-streamed SECOND block instead of streaming raw JSON', () => {
    const raw = `Pick one.\n${block(JSON.stringify(GOALS))}\nAnd also —\n\`\`\`${COACH_PICKS_FENCE}\n{"multi":false,"opt`;
    const out = parseCoachTurn(raw);
    expect(out.text).toBe('Pick one.\nAnd also —');
    expect(out.text).not.toContain('{"multi"');
  });

  it('handles a build card following an answer widget — the build card wins', () => {
    const raw = `Ready?\n${block(JSON.stringify(GOALS))}\n${block('{"build":true,"progress":0.9}')}`;
    const out = parseCoachTurn(raw);
    expect(out.text).toBe('Ready?');
    expect(out.picks?.build).toBe(true);
  });
});

describe('coercePicks', () => {
  it("accepts a build block with no options — its content is the user's own data", () => {
    const picks = coercePicks({ build: true, progress: 0.9 });
    expect(picks?.build).toBe(true);
    expect(picks?.options).toEqual([]);
  });

  /**
   * A session keeps the instructions it was born with, so every conversation that was open when
   * the layout left the protocol is still emitting the old words. The presentation ones cost
   * nothing to drop. `confirm` is not one of them: it is the build card, and the build card is the
   * only route to a plan, so dropping it would leave a live conversation agreeing to build a week
   * that then never got built.
   */
  it('still reads a live session\'s "confirm" as the build card, and ignores the shapes', () => {
    expect(coercePicks({ layout: 'confirm', progress: 0.9 })?.build).toBe(true);
    expect(coercePicks({ layout: 'tiles', options: [{ label: '3' }] })?.build).toBeUndefined();
    expect(coercePicks({ layout: 'grid', options: [{ label: 'a' }] })?.options).toHaveLength(1);
  });

  /**
   * The 2026-08-16 bug from the other side. `ChangeCard` reads the stored proposal now, so an old
   * session's `change` tag has to draw nothing at all rather than an empty widget under the turn.
   */
  it('drops a bare change block, because that card follows the stored proposal', () => {
    expect(coercePicks({ layout: 'change' })).toBeNull();
  });

  it('rejects a block with no usable options', () => {
    expect(coercePicks({ options: [] })).toBeNull();
    expect(coercePicks({ options: [{ hint: 'no label' }] })).toBeNull();
    expect(coercePicks({ multi: true })).toBeNull();
    expect(coercePicks('nope')).toBeNull();
  });

  it('drops unusable options but keeps the rest', () => {
    const picks = coercePicks({ options: [{ label: 'a' }, null, { label: '' }, { label: 'b' }] });
    expect(picks?.options.map((o) => o.label)).toEqual(['a', 'b']);
  });

  it('caps the option count so a turn can never become a form', () => {
    const options = Array.from({ length: 20 }, (_, i) => ({ label: `${i}` }));
    expect(coercePicks({ options })?.options).toHaveLength(8);
  });

  it('clamps progress into 0–1 and ignores a non-numeric one', () => {
    expect(coercePicks({ options: [{ label: 'a' }], progress: 4 })?.progress).toBe(1);
    expect(coercePicks({ options: [{ label: 'a' }], progress: -1 })?.progress).toBe(0);
    expect(coercePicks({ options: [{ label: 'a' }], progress: 'half' })?.progress).toBeUndefined();
  });

  it('defaults multi to false — one answer unless the coach says otherwise', () => {
    expect(coercePicks({ options: [{ label: '3' }] })?.multi).toBe(false);
  });

  it('keeps only recognised areas', () => {
    const picks = coercePicks({
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
      multi: false,
      options: [{ label: '3', say: '3 days a week feels right.', hint: 'most people keep this' }],
    };
    expect(composePickMessage(days, [0])).toBe('3 days a week feels right.');
  });

  it('falls back to the label when an option has no say', () => {
    expect(composePickMessage({ multi: false, options: [{ label: 'Mornings' }] }, [0])).toBe('Mornings');
  });

  it('is empty for an empty selection, which is what keeps send inert', () => {
    expect(composePickMessage(GOALS, [])).toBe('');
  });
});
