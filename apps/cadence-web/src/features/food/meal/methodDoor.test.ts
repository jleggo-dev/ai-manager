/**
 * The tile → door table. A router that decides which surface opens fails silently — the wrong
 * one opens and nothing throws — so it ships with positives AND the near-misses (CLAUDE.md,
 * owner 2026-09-01). The near-misses that matter here are the two pairs that look alike:
 * voice is chat with the mic live, not its own screen; picture routes nowhere, because its
 * tile is a file input and the caller already holds the photo.
 */
import { describe, expect, it } from 'vitest';
import type { CaptureMethod } from '../MethodTiles.tsx';
import type { MealDoor } from './MealDoors.tsx';
import { doorForMethod } from './methodDoor.ts';

const TABLE: Array<[CaptureMethod, MealDoor | null]> = [
  ['chat', { at: 'chat' }],
  ['voice', { at: 'chat', listening: true }],
  ['search', { at: 'add' }],
  ['barcode', { at: 'barcode' }],
  ['picture', null],
];

describe('doorForMethod', () => {
  it.each(TABLE)('%s opens %o', (method, door) => {
    expect(doorForMethod(method)).toEqual(door);
  });

  it('never sends a tile to the meal it was tapped from', () => {
    // Every method except picture answers "how do you want to add this". Returning null for one
    // of them drops the user back on the meal's own picker, asking the question again — the
    // 2026-09-06 regression. Picture is the single, deliberate exception.
    for (const [method, door] of TABLE) {
      if (method === 'picture') continue;
      expect(door, `${method} must open a door`).not.toBeNull();
    }
  });

  it('voice and chat are one screen — same door, mic live', () => {
    const chat = doorForMethod('chat');
    const voice = doorForMethod('voice');
    expect(voice?.at).toBe(chat?.at);
    expect(voice).toMatchObject({ listening: true });
    expect(chat).not.toMatchObject({ listening: true });
  });
});
