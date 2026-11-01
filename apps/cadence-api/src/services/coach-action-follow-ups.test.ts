import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowUp } from '../repos/follow-ups.ts';

/**
 * The two actions against a faked repo. What is asserted is the contract TOOL-HARNESS step 5 cares
 * about: the return text claims only what the call itself did — "noted" only when a row came back,
 * "closed" only when one matched — and a bad input changes nothing and says so.
 */
const store = vi.hoisted(() => ({
  noted: [] as Array<{ text: string; due_on: string | null }>,
  closed: [] as Array<{ id: string; outcome: string | null }>,
  closeResult: null as FollowUp | null,
}));

vi.mock('../repos/follow-ups.ts', () => ({
  FOLLOW_UP_ID_PREFIX: 8,
  noteFollowUp: vi.fn(async (_userId: string, input: { text: string; due_on?: string | null }) => {
    store.noted.push({ text: input.text, due_on: input.due_on ?? null });
    return {
      follow_up_id: '3f9a2c1d-0000-4000-8000-000000000000',
      text: input.text,
      due_on: input.due_on ?? null,
      created_at: '2026-10-31T10:00:00.000Z',
      age_days: 0,
    } satisfies FollowUp;
  }),
  closeFollowUp: vi.fn(async (_userId: string, id: string, _by: string, outcome: string | null) => {
    store.closed.push({ id, outcome });
    return store.closeResult;
  }),
}));

const { NOTE_FOLLOW_UP, CLOSE_FOLLOW_UP } = await import('./coach-action-follow-ups.ts');
const USER = '00000000-0000-4000-a000-000000000001';

beforeEach(() => {
  store.noted = [];
  store.closed = [];
  store.closeResult = null;
});

describe('note_follow_up', () => {
  it('writes her words and reads the id back into the reply', async () => {
    const out = await NOTE_FOLLOW_UP.run(USER, { text: 'ask how the race entry went', due_on: '2026-11-07' });
    expect(store.noted).toEqual([{ text: 'ask how the race entry went', due_on: '2026-11-07' }]);
    expect(out).toContain('Noted [3f9a2c1d]');
    expect(out).toContain('due 2026-11-07');
  });

  it('omitting due_on stores null and says nothing about a date', async () => {
    const out = await NOTE_FOLLOW_UP.run(USER, { text: 'see how the knee is' });
    expect(store.noted[0]?.due_on).toBeNull();
    expect(out).not.toContain('due');
  });

  it.each([
    ['empty text', { text: '   ' }, 'nothing was noted'],
    ['a date in the wrong shape', { text: 'x', due_on: 'next friday' }, 'YYYY-MM-DD'],
    // The shape passes and the day does not exist: before P7b this reached the insert, the ::date
    // cast threw, and she was told "fault" with no reason she could fix.
    ['a day that does not exist', { text: 'x', due_on: '2026-02-30' }, 'a real day'],
    ['text past the limit', { text: 'x'.repeat(301) }, 'under 300'],
  ])('refuses %s and writes nothing', async (_label, params, phrase) => {
    const out = await NOTE_FOLLOW_UP.run(USER, params);
    expect(store.noted).toEqual([]);
    expect(out).toContain(phrase);
  });
});

describe('close_follow_up', () => {
  it('closes by the bracketed prefix and repeats the outcome', async () => {
    store.closeResult = {
      follow_up_id: '3f9a2c1d-0000-4000-8000-000000000000',
      text: 'ask how the race entry went',
      due_on: null,
      created_at: '2026-10-31T10:00:00.000Z',
      age_days: 3,
    };
    const out = await CLOSE_FOLLOW_UP.run(USER, { id: '3f9a2c1d', outcome: 'entry confirmed' });
    expect(store.closed).toEqual([{ id: '3f9a2c1d', outcome: 'entry confirmed' }]);
    expect(out).toContain('Closed [3f9a2c1d]');
    expect(out).toContain('entry confirmed');
  });

  it('says nothing was closed when no open item matches — never "done"', async () => {
    const out = await CLOSE_FOLLOW_UP.run(USER, { id: 'deadbeef' });
    expect(out).toContain('Nothing was closed');
    expect(out).not.toMatch(/^Closed/);
  });

  it.each([
    ['in brackets, as her context prints it', '[3f9a2c1d]', '3f9a2c1d'],
    ['with a label in front', 'id: 3f9a2c1d', '3f9a2c1d'],
    ['upper case', '3F9A2C1D', '3f9a2c1d'],
  ])('passes the repo the bare id when she sends it %s', async (_label, sent, reached) => {
    await CLOSE_FOLLOW_UP.run(USER, { id: sent });
    expect(store.closed).toEqual([{ id: reached, outcome: null }]);
  });

  it.each([
    ['eight underscores', '________'],
    ['two ids', '3f9a2c1d 7b2e0f11'],
    ['too short', '[3f9a]'],
  ])('refuses %s before the repo is asked, and says why', async (_label, sent) => {
    const out = await CLOSE_FOLLOW_UP.run(USER, { id: sent });
    expect(store.closed).toEqual([]);
    expect(out).toMatch(/^nothing changed: .*not one id/);
  });

  it('an empty id is refused before the repo is asked', async () => {
    const out = await CLOSE_FOLLOW_UP.run(USER, { id: '' });
    expect(store.closed).toEqual([]);
    expect(out).toContain('nothing was closed');
  });
});
