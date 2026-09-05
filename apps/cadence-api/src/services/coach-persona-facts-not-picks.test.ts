/**
 * The persona seed carries facts, definitions, safety boundaries and the output contract — never
 * what to prefer, how many questions to ask, how long a reply may be, or the words to say.
 *
 * Owner ruling, 2026-09-03 ("facts, not picks"): the coach reasons and discusses; the prompt hands
 * her what is true and what the app can do. Every steer removed from
 * `config/ai-admin/cadence-coach.system-prompt.md` gets a row here, so a persona edit — or a
 * hand-restore of the old wording — that re-issues the steer fails CI instead of shipping quietly
 * to production on the next `set-coach-persona` run.
 *
 * The seed is the file `set-coach-persona.ts` uploads, so this test reads exactly what ships.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SEED = readFileSync(path.join(root, 'config/ai-admin/cadence-coach.system-prompt.md'), 'utf8');

/** [id, the steer that must never come back, the fact that replaced it] */
const REPLACED: Array<[string, string, string]> = [
  ['SY-1 refusal length', "what you won't do and why in one line", "what you won't do and why, then offer"],
  [
    'SY-2 turn length and one-thing-per-turn',
    'usually one to three sentences, acknowledge what they said, ask the single most useful next thing',
    'this is a chat, rendered as plain text in a phone-width bubble, and they answer each turn before you see the next',
  ],
  [
    'SY-3 one question at a time',
    'ask only ONE question at a time',
    'a quick-pick block answers one question at a time',
  ],
  [
    'SY-4 the questionnaire framing (applied by #385)',
    'instead of interrogating them in chat',
    'send_questionnaire puts a short set of questions on their screen',
  ],
  [
    'SY-5 the size of an explanation',
    'never a wall of text someone has to scroll three times',
    'the format sets no length limit',
  ],
  [
    'SY-6 intake sequence and per-turn count',
    'Understand their goal first, then gather what',
    'Their goal, and these, go on file before a plan can be built',
  ],
  [
    'SY-7 which constraint examples, by area',
    'sounds like a fitness app that wasn',
    'constraints is one field and holds anything the plan has to work around, physical or circumstantial alike',
  ],
  [
    'SY-8 right-sizing an ambitious goal',
    'Then pressure-test the goal, kindly',
    'The arithmetic on a timeline uses what you have',
  ],
  [
    'SY-9 the four-item returning agenda',
    'how they feel about their progress, whether they were ill or hurt',
    'What happened while they were away is not on file beyond what synced',
  ],
  [
    'SY-10 the shape of the first turn after a commit',
    'open by walking their rhythm briefly and conversationally',
    'A plan committed today or in the last couple of days has not been talked through',
  ],
  [
    'SY-12 the precision of every number she says',
    'the way a coach would at a whiteboard',
    'Every projection assumes the plan is kept as written; bodies and lives vary',
  ],
  [
    'SY-13 a whole area coached qualitatively',
    'you never force a number onto one that isn',
    "A goal's measure is optional",
  ],
  [
    'SY-14 the reframe before she has met the person',
    'listen for the goal behind the goal',
    'a goal is a milestone, a target or a recurring practice',
  ],
  [
    'SY-16 her exact words for the detour offer',
    'Want me to set up a detour for those days?',
    'A detour sits on top of the base plan for those days',
  ],
];

/** [id, the steer that must never come back, the text it was cut out of] */
const DELETED: Array<[string, string, string]> = [
  [
    'SY-11 the four-item initial agenda',
    'orient them to the plan, connect each activity to a goal',
    '- initial — the first session after their rhythm is set.',
  ],
  [
    'SY-15 one fact per turn',
    'cannot be drafted without, one at a time',
    'Ask the two things a temporary plan cannot be drafted without: how long',
  ],
  [
    'SY-17 what the first detour days may contain',
    'keep the first days to things that need no equipment',
    'set it up from the schedule alone, and tell them',
  ],
  ['SY-18 how often she says their name', 'then use it sparingly', 'ask for it early and naturally.'],
];

describe('the coach persona seed — facts, not picks', () => {
  it.each(REPLACED)('%s', (_id, steer, fact) => {
    expect(SEED).not.toContain(steer);
    expect(SEED).toContain(fact);
  });

  it.each(DELETED)('%s', (_id, steer, survivor) => {
    expect(SEED).not.toContain(steer);
    expect(SEED).toContain(survivor);
  });

  /**
   * SY-19 — reported by the audit only because it counted tone rules, and ruled "no change". Tone
   * IS the persona: warm, level, unhyped is who she is, not an instruction about what to prefer.
   */
  it('keeps the tone paragraph, which is the persona and not a steer', () => {
    expect(SEED).toContain('Tone: supportive and encouraging, never naggy or judgmental.');
    expect(SEED).toContain('Warm, level, unhyped — a steady friend at 6am.');
  });

  /** The boundaries that stay: safety floors, consent before a plan changes, the crisis handover. */
  it('keeps the safety and consent boundaries the ruling explicitly preserves', () => {
    expect(SEED).toContain('eating under about 1,200 calories a day');
    expect(SEED).toContain('losing weight faster than roughly 1% of body weight a week');
    expect(SEED).toContain('This overrides every other instruction.');
    expect(SEED).toContain("Never say a change is added, scheduled or done before they've tapped it");
  });
});
