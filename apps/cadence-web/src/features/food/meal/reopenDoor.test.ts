/**
 * Where the drawer opens on its first render — a router over "the read we were relaunched in" and
 * "the door the caller chose", so a table of positives and near-misses (CLAUDE.md: every router).
 */
import { describe, it, expect } from 'vitest';
import { describeToReopen, doorToReopen } from './reopenDoor.ts';
import type { ReadInProgress } from '../readInProgress.ts';

const read = (over: Partial<ReadInProgress>): ReadInProgress => ({
  door: 'describe',
  meal: 'lunch',
  date: '2026-11-03',
  requestId: 'req-1',
  kind: 'words',
  words: "a pint of Rickard's Red",
  ...over,
});

describe('doorToReopen / describeToReopen', () => {
  it.each([
    [
      'a read in the describe sheet → the sheet, with the words back in the box, no door',
      undefined,
      read({ door: 'describe', listening: true }),
      null,
      { seed: "a pint of Rickard's Red", listening: true, resume: read({ door: 'describe', listening: true }) },
    ],
    [
      'a read in the chat door → the chat door, no sheet',
      undefined,
      read({ door: 'chat' }),
      { at: 'chat', listening: undefined, resume: read({ door: 'chat' }) },
      null,
    ],
    [
      'a read in the photo door → the photo door with the picture and the caption back',
      undefined,
      read({ door: 'photo', kind: 'photo_read', words: 'a latte', photo: 'data:image/jpeg;base64,xx' }),
      {
        at: 'photo',
        photo: 'data:image/jpeg;base64,xx',
        caption: 'a latte',
        resume: read({ door: 'photo', kind: 'photo_read', words: 'a latte', photo: 'data:image/jpeg;base64,xx' }),
      },
      null,
    ],
    [
      'a read to pick up outranks the door the caller chose',
      { at: 'barcode' },
      read({ door: 'chat' }),
      { at: 'chat', listening: undefined, resume: read({ door: 'chat' }) },
      null,
    ],
    [
      'no read, a chat openAt → the sheet (voice live), no door',
      { at: 'chat', listening: true },
      undefined,
      null,
      { listening: true },
    ],
    ['no read, a photo openAt → that door', { at: 'photo', photo: 'p' }, undefined, { at: 'photo', photo: 'p' }, null],
    ['nothing → the shelves', undefined, undefined, null, null],
  ] as const)('%s', (_name, openAt, resume, door, describe) => {
    expect(doorToReopen(openAt, resume)).toEqual(door);
    expect(describeToReopen(openAt, resume)).toEqual(describe);
  });
});
