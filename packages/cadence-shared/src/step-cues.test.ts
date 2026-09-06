import { describe, expect, it } from 'vitest';
import { bodyCheckinPart, bodyCheckinPrompt, isOpenEndedTimer, mentionsSides } from './step-cues.ts';

/**
 * Table tests for the three step-word routers, positives AND near-misses — the owner's rule for
 * any regex that decides behaviour. Each row is a real step title or cue from a prescribed
 * session, or the near-miss that would have fooled a looser pattern.
 */
describe('isOpenEndedTimer — a hold ends, an effort keeps going', () => {
  it.each([
    [60, false, 'a calf stretch'],
    [120, false, 'a two-minute plank'],
    [9 * 60 + 59, false, 'just under the line'],
    [10 * 60, true, 'a ten-minute easy jog'],
    [50 * 60, true, 'the ruck'],
  ])('%d s → %s (%s)', (seconds, expected) => {
    expect(isOpenEndedTimer(seconds)).toBe(expected);
  });
});

describe('mentionsSides — the cue asks for the other side', () => {
  it.each([
    ['Hold 30s, then switch sides', true],
    ['30 seconds each side', true],
    ['Calf stretch (each leg)', true],
    ['Per side, keep the heel down', true],
    ['Both sides, slow', true],
    ['Repeat on the other leg', true],
    ['Swap legs halfway', true],
    ['Change sides at the bell', true],
    ['Hold each foot for 30s', true],
  ])('"%s" → %s', (text, expected) => {
    expect(mentionsSides(text)).toBe(expected);
  });

  const misses: [string | null, boolean, string][] = [
    ['Side plank', false, 'one side, one hold'],
    ['Lateral side steps', false, 'a direction, not a repeat'],
    ['Walk to the far side of the park', false, 'a place'],
    ['Keep it conversational', false, 'no sides at all'],
    ['Side-lying leg raise', false, 'a position'],
    ['', false, 'empty'],
    [null, false, 'absent'],
  ];
  it.each(misses)('"%s" → %s (%s)', (text, expected) => {
    expect(mentionsSides(text)).toBe(expected);
  });
});

describe('bodyCheckinPart — a check on a body part is not a mood check', () => {
  it.each([
    ['Knee check-in', 'knee'],
    ['How is the ankle?', 'ankle'],
    ['Hip check', 'hip'],
    ['Lower back check-in', 'lower back'],
    ['How does your back feel', 'back'],
    ['Shoulder check-in', 'shoulder'],
    ['Achilles check', 'achilles'],
    ['Check on the knees', 'knees'],
  ])('"%s" → %s', (text, expected) => {
    expect(bodyCheckinPart(text)).toBe(expected);
  });

  const notBody: [string | null, string][] = [
    ['How are you doing?', 'the feeling log’s own question'],
    ['Mood check', 'mood is the head'],
    ['Energy check-in', 'energy is the head'],
    ['Back to the mat', 'a direction, not a body part'],
    ['Settle in', 'a cue'],
    ['Kneel and breathe', '"kneel" is not "knee"'],
    ['', 'empty'],
    [null, 'absent'],
  ];
  it.each(notBody)('"%s" → null (%s)', (text) => {
    expect(bodyCheckinPart(text)).toBeNull();
  });

  it('asks in the coach’s plain voice, singular or plural', () => {
    expect(bodyCheckinPrompt('knee')).toBe('How is the knee?');
    expect(bodyCheckinPrompt('knees')).toBe('How are the knees?');
    expect(bodyCheckinPrompt('feet')).toBe('How are the feet?');
    expect(bodyCheckinPrompt('achilles')).toBe('How is the achilles?');
  });
});
