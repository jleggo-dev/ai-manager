import { describe, expect, it } from 'vitest';
import type { FollowUp } from '../../repos/follow-ups.ts';
import { AGE_SHOWN_AFTER_DAYS, FOLLOW_UPS_HEADING, renderFollowUps } from './follow-ups-function.ts';

const fu = (over: Partial<FollowUp> = {}): FollowUp => ({
  follow_up_id: '3f9a2c1d-0000-4000-8000-000000000000',
  text: 'ask how the race entry went',
  due_on: null,
  created_at: '2026-10-31T10:00:00.000Z',
  age_days: 0,
  ...over,
});

/**
 * The section as the coach reads it. Facts only: what is open, its date, its age — never which to
 * raise. The bracketed id is what close_follow_up takes, so it must be exactly the prefix the repo
 * matches on.
 */
describe('renderFollowUps', () => {
  it('renders nothing at all when nothing is open — the floor must cost nothing then', () => {
    expect(renderFollowUps([])).toBe('');
  });

  it('one item: heading, the short id, her words, and how to close it', () => {
    const out = renderFollowUps([fu()]);
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
    expect(renderFollowUps([item])).toContain(tag);
  });

  it.each([
    ['fresh', 0],
    ['exactly at the threshold', AGE_SHOWN_AFTER_DAYS],
  ])('near-miss: %s does not show an age', (_label, age_days) => {
    expect(renderFollowUps([fu({ age_days })])).not.toContain('open ');
  });

  it('never tells her which one to raise', () => {
    const out = renderFollowUps([
      fu(),
      fu({ follow_up_id: 'aaaaaaaa-0000-4000-8000-000000000000', text: 'see how the knee is' }),
    ]);
    expect(out).not.toMatch(/raise|bring up|mention|ask now|first/i);
  });

  it('lists what it is given in order, one line each — the cap is the repo query, not the render', () => {
    const items = Array.from({ length: 9 }, (_, i) =>
      fu({ follow_up_id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, text: `item ${i}` }),
    );
    const lines = renderFollowUps(items)
      .split('\n')
      .filter((l) => l.startsWith('- ['));
    expect(lines).toHaveLength(9);
    expect(lines[0]).toContain('item 0');
  });
});
