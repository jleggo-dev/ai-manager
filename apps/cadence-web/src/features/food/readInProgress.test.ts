/**
 * The meal read remembered on disk for a relaunch (readInProgress.ts): what comes back, and the
 * four reasons it does not — an older shape, another person's, too old, or unreadable. The same
 * rules the walkthrough's session follows, because the failure is the same: a device reopening
 * something that is not this person's, or not now.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  READ_IN_PROGRESS_KEY,
  READ_IN_PROGRESS_VERSION,
  READ_MAX_AGE_MS,
  clearReadInProgress,
  readReadInProgress,
  rememberRead,
  type ReadInProgress,
} from './readInProgress.ts';

const read: ReadInProgress = {
  door: 'chat',
  meal: 'dinner',
  date: '2026-11-03',
  requestId: '3f2c9b1e-4d5a-4c6b-8e7f-1a2b3c4d5e6f',
  kind: 'words',
  words: "a pint of Rickard's Red",
  correction: { words: 'it was the 0.0 one', previous: ['Rickards Red, 1 pint'] },
  listening: true,
};

beforeEach(() => window.localStorage.clear());

describe('readInProgress', () => {
  it('remembers a read and gives it back whole', () => {
    rememberRead(read);
    expect(readReadInProgress()).toEqual(read);
  });

  it('the photo door’s read keeps the picture, the reading and the stored photo’s ref', () => {
    const photo: ReadInProgress = {
      door: 'photo',
      meal: 'breakfast',
      date: '2026-11-03',
      requestId: '3f2c9b1e-4d5a-4c6b-8e7f-1a2b3c4d5e6f',
      kind: 'photo_preview',
      words: 'a latte and a banana',
      photo: 'data:image/jpeg;base64,xx',
      reading: 'A latte and a banana.\n\n1 venti latte\n1 medium banana',
      photoRef: 'u1/2026-11-03/plate.jpg',
    };
    rememberRead(photo);
    expect(readReadInProgress()).toEqual(photo);
  });

  it('clearing forgets it', () => {
    rememberRead(read);
    clearReadInProgress();
    expect(readReadInProgress()).toBeNull();
  });

  it('a read older than READ_MAX_AGE_MS is not reopened — and is forgotten on sight', () => {
    const then = Date.now() - READ_MAX_AGE_MS - 1;
    rememberRead(read, then);
    expect(readReadInProgress()).toBeNull();
    expect(window.localStorage.getItem(READ_IN_PROGRESS_KEY)).toBeNull();
  });

  it('a read just inside the age is reopened', () => {
    rememberRead(read, Date.now() - READ_MAX_AGE_MS + 5_000);
    expect(readReadInProgress()).toEqual(read);
  });

  it.each([
    ['an older shape', { v: READ_IN_PROGRESS_VERSION - 1 }],
    ['another person’s read', { owner: 'someone-else' }],
    ['a door that does not exist', { door: 'barcode' }],
    ['a kind that does not exist', { kind: 'voice' }],
    ['no request id', { requestId: undefined }],
  ])('%s is not reopened', (_name, over) => {
    rememberRead(read);
    const stored = JSON.parse(window.localStorage.getItem(READ_IN_PROGRESS_KEY)!) as Record<string, unknown>;
    window.localStorage.setItem(READ_IN_PROGRESS_KEY, JSON.stringify({ ...stored, ...over }));
    expect(readReadInProgress()).toBeNull();
  });

  it('an unreadable store is "nothing remembered", never a crash', () => {
    window.localStorage.setItem(READ_IN_PROGRESS_KEY, '{not json');
    expect(readReadInProgress()).toBeNull();
  });
});
