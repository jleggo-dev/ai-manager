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

  /**
   * Picks are an affordance she can reach for on any turn, stated as what the block costs and what
   * it saves — not a default she has to justify leaving off (owner ruling 2026-09-03, PP-8/PP-9).
   */
  it('states what a picks block costs and saves, without making it a default she must justify', () => {
    const out = renderPickProtocol({ intent: 'onboarding' });
    expect(out).toContain('PICKS ATTACH TO ANY TURN, IN ANY CONVERSATION');
    expect(out).toContain('With no block, the only way to answer is to type.');
    expect(out).not.toContain('DEFAULT TO PICKS');
    expect(out).not.toContain('Leaving the block off is the exception you justify');
    expect(out).not.toContain('A NARROWING FOLLOW-UP ALWAYS GETS PICKS');
  });

  /**
   * Presentation stopped being hers on 2026-08-16, the day a layout she had to remember — and
   * forgot — cost the owner four turns of asking for a plan change she had already made. She is
   * asked for content; the client derives the shape from it (`derivePickLayout`, cadence-web). A
   * protocol that still named a shape would be teaching live sessions the failure back.
   */
  it('asks for content and never for a shape', () => {
    for (const intent of ['onboarding', 'ongoing']) {
      const out = renderPickProtocol({ intent });
      expect(out).toContain('NEVER SEND A "layout"');
      // The old vocabulary, in every place it used to be spelled out.
      expect(out).not.toMatch(/layout "(list|tiles|confirm|change)"/i);
      expect(out).not.toMatch(/\btiles\b/i);
      expect(out).not.toMatch(/\(list, (single|multi)\)/i);
      // The one thing she still declares, because it is an act and not a shape: nothing durable is
      // stored for the client to follow, so the build card can only come from her saying so.
      expect(out).toContain('"build": true');
    }
  });

  /**
   * Owner ruling 2026-09-03 supersedes the 2026-08-10 one. Frequency is the most load-bearing
   * number in a training plan and forbidding the question was a steer justified by a claim about
   * everybody ("nobody eats well three days a week"). She gets the fact instead: a commitment
   * carries its own repeat days, and get_active_plan lists them.
   */
  it('states where the repeat days live rather than forbidding the frequency question', () => {
    const out = renderPickProtocol({ intent: 'onboarding' });
    expect(out).toContain('A commitment carries the days it repeats on, and get_active_plan lists them.');
    expect(out).toContain('If they volunteer a number of days, keep it.');
    expect(out).not.toContain('NEVER ask how many days a week');
    expect(out).not.toMatch(/nobody eats well three days a week/);
    expect(out).not.toMatch(/just never ask for one/);
    // The plain-language question wording survives; it was never the steer.
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

  /**
   * The narrowing BUDGET was a steer (PP-2); the distinction it introduced — depth is not
   * repetition — is a fact about intake and stays.
   */
  it('keeps the depth-is-not-repetition point without budgeting her turns', () => {
    const out = renderPickProtocol({ intent: 'onboarding' });
    expect(out).not.toMatch(/One or two narrowing turns per goal/);
    expect(out).not.toMatch(/stop refining the what/);
    expect(out).toMatch(/What turns intake into a form is REPETITION/);
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
   * The 2026-08-12 fix told her which examples to raise, in which order, per area — a steer. The
   * fact underneath is that `constraints` is ONE field spanning the physical and the
   * circumstantial, and the examples now sit in one undifferentiated list (PP-5; the same edit
   * lands in the persona seed as SY-7).
   */
  it('states constraints as one field spanning body and life, without ordering the examples', () => {
    const out = renderPickProtocol({ intent: 'onboarding' });
    expect(out).toContain('constraints is one field and holds anything the plan has to work around');
    expect(out).toMatch(/wrists for a writer, a back for anyone who sits/);
    expect(out).not.toContain('THE QUESTION IS THE SAME; THE EXAMPLES ARE NOT');
    expect(out).not.toMatch(/Do NOT open that one with an injury/);
    expect(out).not.toMatch(/so put it last and in those words/);
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

/**
 * Owner ruling 2026-09-03, "facts, not picks": this block hands the coach what is true about the
 * app — what a commitment carries, which field holds what, what a tool does — and never what to
 * prefer, how many questions to ask, how long to speak, or the words to say. Each row below is one
 * steer the audit removed, pinned so a hand-restore of the old wording fails CI.
 */
describe('the pick protocol carries facts, not picks', () => {
  const onboarding = renderPickProtocol({ intent: 'onboarding' });

  /** [id, the steer that must never come back, the fact that replaced it] */
  const rows: Array<[string, string, string]> = [
    [
      'PP-1 — a vague goal is not accepted',
      'A goal you cannot put on a calendar is not captured yet',
      'A plan is built from commitments, and a commitment carries a day, a time and a length.',
    ],
    [
      'PP-3 — the time-of-day answer set',
      'offer morning / midday / evening / flexible (one answer)',
      'availability records every window they name',
    ],
    [
      'PP-4 — the session-length answer set',
      'offering 10 / 20 / 30 / 45+ as the labels',
      'session_minutes records how long ONE session can run door to door',
    ],
    [
      'PP-6 — extra habits are routines, not goals',
      'Each yes becomes a small anchored routine in the plan, not a new goal',
      'Anything they name here can be stored either as a commitment on their plan or as a goal of its own.',
    ],
    [
      'PP-12 — the question budget before a whole-week reshape',
      'in at most a couple of questions',
      'settle WHAT should change with the user, then make ONE call carrying the full edit slate',
    ],
  ];

  it.each(rows)('%s', (_id, steer, fact) => {
    expect(onboarding).not.toContain(steer);
    expect(onboarding).toContain(fact);
  });

  /** PP-7 and PP-11: two more copies of the one-question rule, and a required cadence of buttons. */
  it.each([
    ['PP-7 — one question per turn, two or three sentences', 'Ask ONE question per turn.'],
    ['PP-7 — the sentence budget before a block', 'Two or three sentences at most before the block'],
    ['PP-11 — never two open questions in a row', 'Never ask two open, pick-less questions in a row'],
  ])('%s is gone', (_id, steer) => {
    expect(onboarding).not.toContain(steer);
  });

  /**
   * PP-13. The cap is genuine contract — the parser silently drops the tail — but the prompt said
   * six and the code enforces eight, so she was told to leave two usable buttons on the table. The
   * enforced number is derived here rather than written down twice: change MAX_OPTIONS in
   * `packages/cadence-shared/src/coach-picks.ts` and this fails until the prompt says the same.
   */
  it('states the cap the parser actually enforces', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ label: `o${i}`, say: `o${i}` }));
    const block = ['```' + COACH_PICKS_FENCE, JSON.stringify({ options: many }), '```'].join('\n');
    const enforced = parseCoachTurn(block).picks?.options.length;
    expect(enforced).toBe(8);
    expect(onboarding).toContain(`At most ${enforced} options; the app drops the rest.`);
    expect(onboarding).not.toContain('Never offer more than six options');
  });
});

/**
 * DESIGN-check-in.md: "a check-in must never be a thing you can be late for" — and its own open
 * question, the empty week, flagged as "most likely to hurt someone if we get it wrong." Neither
 * case is intake or onboarding, so unlike the first-conversation script these rules render for
 * every intent — a returning user is exactly who arrives late or comes back to an empty week.
 */
describe('the check-in edge cases — late arrivals and empty weeks', () => {
  it('renders the section for every intent, not just onboarding', () => {
    for (const intent of [undefined, 'onboarding', 'ongoing', 'initial']) {
      const out = renderPickProtocol(intent ? { intent } : {});
      expect(out).toContain('THE CHECK-IN — LATE, AND THE WEEK NOBODY LOGGED');
    }
  });

  it('bans "overdue" and any day-count in her own words, while allowing the fact she reasons from', () => {
    const out = renderPickProtocol();
    expect(out).toMatch(/NEVER SAY "OVERDUE"/);
    expect(out).toMatch(/NEVER COUNT THE DAYS OUT LOUD/);
    expect(out).toMatch(/never apologize on their behalf/i);
    // PP-18: the no-shame boundary is carried by the two sentences above; the reply LENGTH was ours.
    expect(out).not.toMatch(/A short, warm acknowledgment is the whole response lateness gets/);
  });

  /**
   * PP-14. The late arrival used to be scripted end to end — one warm line, no asking what
   * happened, exactly two picks, and her sentence written out. What she gets now is the boundary
   * (a check-in is not a thing you can be late for) and both tools, open.
   */
  it('names both tools for a late arrival instead of scripting the turn', () => {
    const out = renderPickProtocol();
    expect(out).toContain('THE LATE ARRIVAL');
    expect(out).toContain('their plan week ended more than 7 days ago');
    expect(out).toContain('A check-in is not a thing they can be late for. Both tools are open');
    expect(out).toMatch(/build_next_week rolls their rhythm forward unchanged/);
    expect(out).not.toMatch(/Acknowledge it in ONE warm line/);
    expect(out).not.toMatch(/do not ask what happened or dwell on the gap/);
    expect(out).not.toMatch(/Then offer exactly two picks/);
    expect(out).not.toContain('say: "Just build my week — I\'m good"');
    expect(out).not.toContain(
      'No problem at all. Want to run through last week now, or should I just build this week and we move on?',
    );
  });

  it('routes "Run through last week" to open_week_review and "Just build this week" to build_next_week', () => {
    const out = renderPickProtocol();
    expect(out).toMatch(
      /"Run through last week" is answered exactly like any other check-in request — call open_week_review/,
    );
    expect(out).toMatch(/"Just build this week" means call build_next_week/);
    // The failure mode this guards: her own build tool is a full resynthesis, not a plain rollover.
    expect(out).toMatch(/Never answer it with your own build card/);
    // Say-texts are editable — the routing is intent, never an exact-string match.
    expect(out).toMatch(/an edited say-text still means the same choice/);
  });

  /**
   * PP-15. The no-shame boundary survives as a boundary ("an empty week is never presented as a
   * failure"); what went is the ban on LOOKING — she may open the review if the conversation wants
   * it, and get_consistency is offered as the cheaper read, not as the only permitted one.
   */
  it('keeps the no-shame boundary for an empty week without forbidding the look', () => {
    const out = renderPickProtocol();
    expect(out).toContain('THE EMPTY WEEK COMES FIRST, EVEN OVER THE LATE OFFER');
    expect(out).toMatch(/get_consistency confirms it more cheaply than opening a card/);
    expect(out).toMatch(/an empty week is never presented as a failure/);
    expect(out).not.toMatch(/do NOT offer "Run through last week" and do NOT call open_week_review/);
    expect(out).not.toMatch(/a card full of zeroes is exactly the shame this product forbids/);
    expect(out).not.toMatch(/reaching for open_week_review to FIND OUT is the one thing to never do here/);
  });

  /** PP-16: her sentence and its three possible answers were ours to write; the record is not. */
  it('states what the app does and does not hold for an unlogged week, and scripts nothing', () => {
    const out = renderPickProtocol();
    expect(out).toContain(
      'Nothing was logged last week, so the app has no record of what happened — get_workout_history has any sessions their device recorded, and beyond that only they can say.',
    );
    expect(out).not.toContain('ASK ONE QUESTION INSTEAD OF REVIEWING ZEROES');
    expect(out).not.toContain(
      "Before I build next week — I don't have much logged from last week, so I'd rather ask than guess. How did it actually go?",
    );
  });

  /** PP-16/PP-17: what they say about the week maps to a tool — a fact about each tool, never the
   *  DIRECTION of the change (no "lighter", no scripted answer labels). */
  it('routes what they say to a tool without naming the direction the change should take', () => {
    const out = renderPickProtocol();
    expect(out).toMatch(/only the logging is missing, build_next_week rolls it forward/);
    expect(out).toMatch(/propose_plan_change carries the change/);
    expect(out).toMatch(/pause_week or a detour holds it without deleting anything/);
    expect(out).not.toContain('(lighter, shorter, fewer days)');
    expect(out).not.toMatch(/lighter build|consolation prize|THE THREE ANSWERS/);
  });
});
