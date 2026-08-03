import { describe, it, expect } from 'vitest';
import {
  BANNED_FEELING_WORDS,
  FEELING_FAMILIES,
  FEELING_FOOTER,
  FEELING_ROOMS,
  allFeelingWords,
  familyExamples,
  familyForWord,
  feelingAcknowledgement,
  feelingLogLine,
  findFamily,
  isFeelingRoom,
  isFeelingWord,
} from './feelings.ts';

describe('the vocabulary', () => {
  it('is six families of five', () => {
    expect(FEELING_FAMILIES).toHaveLength(6);
    for (const f of FEELING_FAMILIES) expect(f.words).toHaveLength(5);
  });

  it('keeps "anxious" — the plainest word someone has for their own state', () => {
    expect(familyForWord('anxious')?.id).toBe('wired');
  });

  it('never offers a word a clinician would write down about you', () => {
    const words = allFeelingWords();
    for (const banned of BANNED_FEELING_WORDS) expect(words).not.toContain(banned);
  });

  it('never uses the word "mood" anywhere in the vocabulary', () => {
    expect(allFeelingWords().join(' ')).not.toMatch(/\bmood\b/);
  });

  it('has no duplicates across families', () => {
    const all = FEELING_FAMILIES.flatMap((f) => f.words);
    expect(new Set(all).size).toBe(all.length);
  });

  it('makes the family word itself selectable — nobody is forced to be more precise than they are', () => {
    for (const f of FEELING_FAMILIES) expect(isFeelingWord(f.name)).toBe(true);
    expect(familyForWord('wired')?.id).toBe('wired');
  });

  it('shows three examples per tile, so step two confirms rather than discovers', () => {
    for (const f of FEELING_FAMILIES) expect(familyExamples(f)).toHaveLength(3);
  });

  it('reaches an unexpected word through the full list', () => {
    expect(isFeelingWord('racing')).toBe(true);
    expect(allFeelingWords().length).toBeGreaterThanOrEqual(36);
  });

  it('rejects anything off the list', () => {
    expect(isFeelingWord('bananas')).toBe(false);
    expect(isFeelingWord(null)).toBe(false);
    expect(isFeelingWord('depressed')).toBe(false);
  });

  it('finds families by id', () => {
    expect(findFamily('foggy')?.name).toBe('Foggy');
    expect(findFamily('nope')).toBeUndefined();
  });
});

describe('room — spatial, never a severity scale', () => {
  it('offers three steps described by space, not number', () => {
    expect(FEELING_ROOMS.map((r) => r.label)).toEqual(['in the background', 'here', 'filling the room']);
  });

  it('never labels a step with a digit or a severity word', () => {
    for (const r of FEELING_ROOMS) {
      expect(r.label).not.toMatch(/\d/);
      expect(r.label).not.toMatch(/mild|moderate|severe|high|low|extreme/i);
    }
  });

  it('validates the stored value', () => {
    expect(isFeelingRoom(2)).toBe(true);
    expect(isFeelingRoom(0)).toBe(false);
    expect(isFeelingRoom(4)).toBe(false);
    expect(isFeelingRoom('2')).toBe(false);
  });
});

describe('the acknowledgement — the instrument’s entire visible surface', () => {
  it('repeats the word and the room back', () => {
    expect(feelingAcknowledgement('on edge', 2)).toBe("On edge, and it's here. Got it — thank you for telling me.");
    expect(feelingAcknowledgement('tired', 1)).toMatch(/in the background/);
    expect(feelingAcknowledgement('restless', 3)).toMatch(/filling the room/);
  });

  it('promises the coach, not a chart', () => {
    expect(FEELING_FOOTER).toBe("I'll bring it up when it's useful.");
    expect(FEELING_FOOTER).not.toMatch(/chart|graph|trend|streak|history/i);
  });

  it('never praises, scores, or compares', () => {
    for (const room of [1, 2, 3] as const) {
      const s = feelingAcknowledgement('anxious', room);
      expect(s).not.toMatch(/good|great|well done|better|worse|again|streak|average/i);
    }
  });
});

describe('feelingLogLine', () => {
  it('reads as a note, never a measurement', () => {
    expect(feelingLogLine('on edge', 2)).toBe('on edge · here');
    expect(feelingLogLine('flat', 1)).toBe('flat · in the background');
  });

  it('never renders the stored number', () => {
    for (const room of [1, 2, 3] as const) expect(feelingLogLine('quiet', room)).not.toMatch(/\d/);
  });
});
