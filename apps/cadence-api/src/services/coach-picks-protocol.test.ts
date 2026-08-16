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

  /**
   * Observed on device: the user tapped a captured goal, sent the drafted fragment, and the coach
   * — handed a turn with no content while her own question was live — simply re-asked it. The
   * client now drafts a complete sentence, but the coach also has to know a correction when she
   * sees one, including a badly-worded one someone typed by hand.
   */
  it('teaches the coach to treat a correction as a turn, and never to re-ask its own question', () => {
    const out = renderPickProtocol({ intent: 'onboarding' });
    expect(out).toContain('A CORRECTION IS A NORMAL TURN');
    expect(out).toContain('NEVER RE-ASK OR RE-ANSWER THE QUESTION YOU JUST ASKED');
  });

  /**
   * Reported 2026-08-12: someone added a goal after the confirmation, and the coach — with her one
   * `confirm` turn already spent — told them to "head to the review section", which has not existed
   * since the v2 redesign. The card is the ONLY route to a plan, so it has to be repeatable and it
   * has to be the thing she reaches for instead of naming a screen.
   */
  it('makes the build card a repeatable tool and forbids sending anyone to a screen', () => {
    for (const intent of ['onboarding', 'ongoing']) {
      const out = renderPickProtocol({ intent });
      expect(out).toContain('BUILD PLAN tool');
      expect(out).toContain('BUILD IS SOMETHING YOU DO, NOT SOMEWHERE YOU SEND THEM');
      expect(out).toMatch(/never tell anyone to "head to Review"/i);
      expect(out).toContain('NEVER LEAVE A CHANGE TO THE PLAN AGREED AND UNBUILT');
      // The old cap is what left her with nowhere to go; it must not survive anywhere.
      expect(out).not.toMatch(/use it exactly once/i);
    }
  });

  /**
   * Reported the same day: asked what they were working around, the coach offered "an injury" to
   * someone whose goal was writing a novel. Wrists are a real constraint for a writer — an injury
   * as the OPENING example is a fitness app that did not listen.
   */
  it('fits the constraints question to the goal instead of leading with an injury', () => {
    const out = renderPickProtocol({ intent: 'onboarding' });
    expect(out).toContain('THE QUESTION IS THE SAME; THE EXAMPLES ARE NOT');
    expect(out).toMatch(/writing a novel/);
    expect(out).toMatch(/hands and wrists/);
  });
});

/**
 * The pick protocol names tools, so demoting one silently makes it a liar.
 *
 * Within an hour of the tiering landing, this block still told her that changing a goal "takes
 * effect the moment you call them" — for tools that were no longer declared. Following it, she
 * would say "changed it to 50, and it is on your file" having changed nothing: the exact failure
 * the owner named, pretending to have done something she had not.
 */
describe('the protocol stays honest about what she is holding', () => {
  it('sends her to find_tools for the demoted actions rather than implying a direct call', () => {
    const out = renderPickProtocol({ intent: 'ongoing' });
    expect(out).toMatch(/NOT loaded by default/);
    expect(out).toMatch(/find_tools first/);
    expect(out).toMatch(/Never say it is done before the call has actually run/i);
  });

  it('names no demoted tool as if it were directly callable', () => {
    const out = renderPickProtocol({ intent: 'ongoing' });
    for (const demoted of ['update_goal', 'correct_log', 'update_constraint', 'set_macro_targets']) {
      expect(out).not.toContain(demoted);
    }
  });
});
