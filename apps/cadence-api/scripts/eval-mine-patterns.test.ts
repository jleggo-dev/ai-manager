/**
 * Every pattern that decides what the miner flags, as a table of positives and near-misses. A
 * near-miss is the sentence most likely to be mistaken for a positive; each one gets a row BEFORE
 * the pattern is trusted, because a wrong flag fails silently (the review file is just noisier, or
 * quieter, and nothing throws).
 */
import { describe, expect, it } from 'vitest';
import { toolFaultText, toolEmptyText } from '../src/services/tool-response.ts';
import {
  FAULT_WORDING,
  attachTools,
  correctsHer,
  findCandidates,
  isFaultOutput,
  pairToolLog,
  promisesChange,
  type MinedTurn,
} from './eval-mine-patterns.ts';

describe('promisesChange — her reply claims a change', () => {
  it.each([
    "I've updated your plan so the long run is on Saturday.",
    "Done — I've moved your easy run to Friday.",
    "I'll move the farmer carries to Thursday.",
    "I've logged that run for you.",
    "Got it, I'll log the chili for lunch.",
    'Changed your long run to an hour.',
    'Okay! Moved your hill intervals to Thursday.',
    'Done — swapped your farmer carries for dead hangs.',
    "I'm going to adjust your targets up a little.",
    "I've just dropped the grip finisher from this week.",
    'Let me update your goal to 50 books.',
    "I've gone ahead and removed the knee from what we work around.",
    'I will shift the 10k to November.',
    'I’ve marked Sunday as not done.',
    "I'm adding the race to your calendar.",
  ])('%s', (reply) => {
    expect(promisesChange(reply)).toBe(true);
  });
});

describe('promisesChange — near-misses that must not trip', () => {
  it.each([
    "I'll move on to your other question.",
    'Let me move on to the food side of things.',
    "I'll update you once the week is built.",
    "Let me change the subject for a second — how's the knee?",
    'Let me add one more thing about recovery.',
    'Want me to move your long run to Saturday?',
    'Should I update your goal to 50 books?',
    'I can move it to Friday if you like.',
    "You've logged three runs this week — that's a good week.",
    'You logged your long run on Sunday, nice.',
    "I'll push you a little harder on the hills next week.",
    "That's a lot of change in one week.",
    'Zone 2 is about building the engine slowly.',
  ])('%s', (reply) => {
    expect(promisesChange(reply)).toBe(false);
  });
});

describe('isFaultOutput — a tool told her it broke', () => {
  it('reads the wording from toolFaultText itself, not a copy', () => {
    expect(FAULT_WORDING.length).toBeGreaterThan(20);
    expect(toolFaultText('X')).toContain(FAULT_WORDING);
  });

  it.each([
    ['the fault text, any subject', toolFaultText('That'), true],
    ['the fault text for a named read', toolFaultText('Your food log'), true],
    ['an empty record is not a fault', toolEmptyText(), false],
    ['an empty record for a named read', toolEmptyText('get_journal'), false],
    ['an ordinary answer', 'Long run, Sunday: 11.4 km in 77 minutes.', false],
    ['nothing came back', null, false],
  ])('%s', (_label, output, want) => {
    expect(isFaultOutput(output)).toBe(want);
  });
});

describe('correctsHer — their next message corrects her', () => {
  it.each([
    'no, the run was on tuesday',
    'No. I said Tuesday, not Thursday',
    "no it's 50 books, not 60",
    'nope, the other one',
    "that's not what i asked",
    'That is not right',
    'like i said, mornings are gone',
    'i told you i cant do mornings',
    'i meant the long run, not the easy one',
    "i didn't say that",
    'i never said i had a knee injury',
    "that's not what i meant",
    "you're wrong about the date",
    "that's completely wrong",
    'you put it on the wrong day',
  ])('%s', (next) => {
    expect(correctsHer(next)).toBe(true);
  });
});

describe('correctsHer — near-misses that must not trip', () => {
  it.each([
    'no problem',
    'No problem, thanks!',
    'no worries',
    'No, thanks',
    'no thanks',
    'no',
    'No.',
    'no more running this week, my knee is sore',
    'no time today honestly',
    'nothing much, just tired',
    'not really',
    "that's not bad at all",
    "that's not too bad",
    'i said to my wife i would run tomorrow',
    "i said i'd try the hills",
    'i meant to log my lunch yesterday',
    'what am i doing wrong with my squat?',
    'nothing wrong with a rest day, right?',
    'thanks, that helps',
  ])('%s', (next) => {
    expect(correctsHer(next)).toBe(false);
  });

  it('a missing next message is not a correction', () => {
    expect(correctsHer(null)).toBe(false);
  });
});

const turn = (over: Partial<MinedTurn>): MinedTurn => ({
  sessionId: 's1',
  at: '2026-10-12T10:00:00.000Z',
  userId: 'u1',
  user: 'move my long run to saturday',
  reply: 'Sure.',
  ms: 20_000,
  tools: [],
  ...over,
});
const isAction = (name: string) => ['propose_plan_change', 'log_session', 'edit_calendar'].includes(name);

describe('findCandidates', () => {
  it('flags a promise with no action, and not one with an action', () => {
    const out = findCandidates(
      [
        turn({ at: '2026-10-12T10:00:00.000Z', reply: "I've moved your long run to Saturday." }),
        turn({
          sessionId: 's2',
          reply: "I've moved your long run to Saturday.",
          tools: [{ name: 'propose_plan_change', output: 'proposed' }],
        }),
      ],
      isAction,
    );
    expect(out.map((c) => [c.turn.sessionId, c.shapes])).toEqual([['s1', ['promised-no-action']]]);
  });

  it('a read alone does not excuse a promise', () => {
    const [c] = findCandidates(
      [turn({ reply: "I'll move it to Friday.", tools: [{ name: 'get_calendar', output: 'Fri: rest' }] })],
      isAction,
    );
    expect(c?.shapes).toEqual(['promised-no-action']);
  });

  it('reads "their next message" within the same conversation only, in time order', () => {
    const out = findCandidates(
      [
        turn({ sessionId: 'a', at: '2026-10-12T10:05:00.000Z', user: 'no, the other run' }),
        turn({ sessionId: 'b', at: '2026-10-12T10:01:00.000Z', user: "that's not what i asked" }),
        turn({ sessionId: 'a', at: '2026-10-12T10:00:00.000Z', user: 'move my run' }),
      ],
      isAction,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.turn.sessionId).toBe('a');
    expect(out[0]!.turn.user).toBe('move my run');
    expect(out[0]!.shapes).toEqual(['corrected-next']);
    expect(out[0]!.next).toBe('no, the other run');
  });

  it('flags faults by tool and slow turns, and skips app-authored turns', () => {
    const out = findCandidates(
      [
        turn({ ms: 125_000, tools: [{ name: 'get_journal', output: toolFaultText('That') }] }),
        turn({ sessionId: 's9', user: '<note>Continue your reply</note>', ms: 200_000 }),
        turn({ sessionId: 's3', ms: 119_000 }),
      ],
      isAction,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.shapes).toEqual(['tool-fault', 'slow']);
    expect(out[0]!.faulted).toEqual(['get_journal']);
  });
});

describe('pairToolLog', () => {
  it('pairs results with calls by name, and names the tool use_tool ran', () => {
    const uses = pairToolLog(
      {
        calls: [
          { name: 'get_nutrition', arguments: '{"view":"log"}' },
          { name: 'use_tool', arguments: '{"name":"edit_calendar","arguments":{"action":"delete"}}' },
          { name: 'get_nutrition', arguments: '{"view":"recipes"}' },
        ],
      },
      {
        results: [
          { name: 'use_tool', output: 'deleted' },
          { name: 'get_nutrition', output: 'log out' },
          { name: 'get_nutrition', output: 'recipes out' },
        ],
      },
    );
    expect(uses).toEqual([
      { name: 'edit_calendar', output: 'deleted' },
      { name: 'get_nutrition', output: 'log out' },
      { name: 'get_nutrition', output: 'recipes out' },
    ]);
  });

  it('keeps a call that has no result, and survives a malformed row', () => {
    expect(pairToolLog({ calls: [{ name: 'made_up_tool' }] }, { results: [] })).toEqual([
      { name: 'made_up_tool', output: null },
    ]);
    expect(pairToolLog(null, null)).toEqual([]);
    expect(pairToolLog({ calls: [{ name: 'use_tool', arguments: 'not json' }] }, null)).toEqual([
      { name: 'use_tool', output: null },
    ]);
  });
});

describe('attachTools', () => {
  const row = (userId: string, at: string) => ({
    userId,
    at,
    input: { calls: [{ name: 'log_session' }] },
    output: { results: [{ name: 'log_session', output: 'logged' }] },
  });

  it('joins tool rows written during the turn, for the same person only', () => {
    const [t] = attachTools(
      [turn({ at: '2026-10-12T10:00:30.000Z', ms: 30_000 })],
      [
        row('u1', '2026-10-12T10:00:10.000Z'), // inside the turn
        row('u2', '2026-10-12T10:00:10.000Z'), // someone else
        row('u1', '2026-10-12T09:58:00.000Z'), // an earlier turn
        row('u1', '2026-10-12T10:00:33.000Z'), // inside the slack after the end
      ],
    );
    expect(t!.tools).toHaveLength(2);
  });
});
