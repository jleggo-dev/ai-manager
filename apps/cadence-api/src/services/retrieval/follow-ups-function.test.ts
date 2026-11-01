import { describe, expect, it } from 'vitest';
import type { FollowUp, FollowUpList } from '../../repos/follow-ups.ts';
import {
  AGE_SHOWN_AFTER_DAYS,
  FACT_REVIEW_TAG,
  FOLLOW_UPS_HEADING,
  NONE_OPEN_LINE,
  renderFollowUps,
} from './follow-ups-function.ts';

const fu = (over: Partial<FollowUp> = {}): FollowUp => ({
  follow_up_id: '3f9a2c1d-0000-4000-8000-000000000000',
  text: 'ask how the race entry went',
  due_on: null,
  created_at: '2026-10-31T10:00:00.000Z',
  age_days: 0,
  ...over,
});

/** A list as the repo hands it over: open = how many are shown unless said otherwise. */
const list = (items: FollowUp[], over: Partial<FollowUpList> = {}): FollowUpList => ({
  items,
  open: items.length,
  everHad: items.length > 0,
  ...over,
});

const many = (n: number, over: Partial<FollowUp> = {}): FollowUp[] =>
  Array.from({ length: n }, (_, i) =>
    fu({ follow_up_id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, text: `item ${i}`, ...over }),
  );

/**
 * The section as the coach reads it. Facts only: what is open, its date, its age — never which to
 * raise. The bracketed id is what close_follow_up takes, so it must be exactly the prefix the repo
 * matches on.
 */
describe('renderFollowUps', () => {
  it('one item: heading, the short id, her words, and how to close it', () => {
    const out = renderFollowUps(list([fu()]));
    expect(out.split('\n')[0]).toBe(FOLLOW_UPS_HEADING);
    expect(out).toContain('- [3f9a2c1d] ask how the race entry went');
    expect(out).not.toContain('3f9a2c1d-0000');
    expect(out).toContain('close_follow_up');
  });

  it.each([
    ['a due date', fu({ due_on: '2026-11-07' }), '(due 2026-11-07)'],
    [
      'old enough to show its age',
      fu({ age_days: AGE_SHOWN_AFTER_DAYS + 4 }),
      `(open ${AGE_SHOWN_AFTER_DAYS + 4} days)`,
    ],
    ['both', fu({ due_on: '2026-11-07', age_days: 45 }), '(due 2026-11-07, open 45 days)'],
  ])('tags: %s', (_label, item, tag) => {
    expect(renderFollowUps(list([item]))).toContain(tag);
  });

  it.each([
    ['fresh', 0],
    ['exactly at the threshold', AGE_SHOWN_AFTER_DAYS],
  ])('near-miss: %s does not show an age', (_label, age_days) => {
    expect(renderFollowUps(list([fu({ age_days })]))).not.toContain('open ');
  });

  it('never tells her which one to raise', () => {
    const out = renderFollowUps(
      list(
        [
          fu(),
          fu({ follow_up_id: 'aaaaaaaa-0000-4000-8000-000000000000', text: 'see how the knee is' }),
          fu({
            follow_up_id: 'bbbbbbbb-0000-4000-8000-000000000000',
            text: 'are you back at the gym?',
            source: 'fact-review',
          }),
        ],
        { open: 11 },
      ),
    );
    expect(out).not.toMatch(/raise|bring up|mention|ask now|first|should|when it fits/i);
  });

  it('lists what it is given in order, one line each — the cap is the repo query, not the render', () => {
    const lines = renderFollowUps(list(many(9)))
      .split('\n')
      .filter((l) => l.startsWith('- ['));
    expect(lines).toHaveLength(9);
    expect(lines[0]).toContain('item 0');
  });
});

/**
 * P7b finding 3: the floor is now the only copy of this list, and it is re-read every turn. When
 * the last item closes it must SAY so — an empty floor is skipped, which left the last list she saw
 * standing in the conversation as if it were current. Someone who never had one has no such list.
 */
describe('renderFollowUps — nothing open', () => {
  it.each([
    ['never had one: nothing at all, so they pay nothing for it', list([], { everHad: false }), ''],
    [
      'had some, all closed: the heading and one line saying so',
      list([], { everHad: true }),
      `${FOLLOW_UPS_HEADING}\n${NONE_OPEN_LINE}`,
    ],
  ])('%s', (_label, given, want) => {
    expect(renderFollowUps(given)).toBe(want);
  });

  it('with something open, the list — never the none line', () => {
    const out = renderFollowUps(list([fu()]));
    expect(out).toContain('- [3f9a2c1d]');
    expect(out).not.toContain(NONE_OPEN_LINE);
  });

  it('the none line offers nothing to close', () => {
    expect(renderFollowUps(list([], { everHad: true }))).not.toContain('close_follow_up');
  });
});

/**
 * P7b finding 2: the cap of 8 used to hide items without a word. Now one line says how many more are
 * open and which part of the order they sit in — stated from the order, never a choice of which.
 */
describe('renderFollowUps — more open than shown', () => {
  it.each([
    ['several, after an undated one', many(8), 11, 'And 3 more open, not shown here: older ones with no date.'],
    ['one, after an undated one', many(8), 9, 'And 1 more open, not shown here: an older one with no date.'],
    [
      'several, after a dated one',
      many(8, { due_on: '2026-11-07' }),
      12,
      'And 4 more open, not shown here: ones due later, or with no date.',
    ],
    [
      'one, after a dated one',
      many(8, { due_on: '2026-11-07' }),
      9,
      'And 1 more open, not shown here: one due later, or with no date.',
    ],
  ])('%s', (_label, items, open, line) => {
    const out = renderFollowUps(list(items, { open })).split('\n');
    expect(out).toContain(line);
    // The count sits after the items and before the closing hint, which stays.
    expect(out.indexOf(line)).toBe(items.length + 1);
    expect(out.at(-1)).toContain('close_follow_up');
  });

  it.each([
    ['all shown', many(8), 8],
    ['fewer than the cap', many(3), 3],
    ['a stale count lower than shown', many(3), 2],
  ])('near-miss: %s → no count line', (_label, items, open) => {
    expect(renderFollowUps(list(items, { open }))).not.toMatch(/more open/);
  });
});

/**
 * P7b finding 4: with the fact review (C7) its questions sit under "THINGS YOU SAID YOU'D COME BACK
 * TO", and she never said them. They carry a short tag saying where they came from; hers do not.
 */
describe('renderFollowUps — where a line came from', () => {
  it.each([
    ['the fact review', fu({ source: 'fact-review', text: 'are you back at the gym?' }), true],
    ['the fact review, with a due date', fu({ source: 'fact-review', due_on: '2026-11-07' }), true],
    ['the coach', fu({ source: 'coach' }), false],
    ['no source (before 0062 reads as hers)', fu(), false],
  ])('%s', (_label, item, tagged) => {
    const line = renderFollowUps(list([item])).split('\n')[1]!;
    expect(line.includes(FACT_REVIEW_TAG)).toBe(tagged);
  });

  it('the tag reads as a plain fact, inside the brackets with the other tags', () => {
    const line = renderFollowUps(list([fu({ source: 'fact-review', due_on: '2026-11-07' })])).split('\n')[1];
    expect(line).toBe(`- [3f9a2c1d] ask how the race entry went (due 2026-11-07, ${FACT_REVIEW_TAG})`);
  });

  it('the tag is short and in plain words (CLAUDE.md brand rules)', () => {
    expect(`(${FACT_REVIEW_TAG})`.length).toBeLessThanOrEqual(45);
    expect(FACT_REVIEW_TAG).not.toMatch(/captured|fact-review|dossier|broker|unlock|empower|journey/i);
  });
});
