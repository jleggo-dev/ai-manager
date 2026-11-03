import type { ReadInProgress } from '../readInProgress.ts';
import type { MealDoor } from './MealDoors.tsx';

/** The pencil (or the mic) — "What did you have?" over the drawer, maybe carrying words already typed, or a read to pick up. */
export interface Describe {
  seed?: string;
  listening?: boolean;
  /** The read the app was relaunched in the middle of: the sheet asks after its answer on open. */
  resume?: ReadInProgress;
}

/**
 * Where the drawer opens (MealScreen's first render): on the read it was relaunched in the middle
 * of (readInProgress.ts) when there is one — the chat door or the photo door, with the words and
 * the picture back in place — else on the door the caller already chose. `openAt: chat` is the
 * describe sheet over the shelves, not a screen of its own, so it is never a door here.
 *
 * Its own file because both answers are routers over the same two inputs, and a router gets a
 * table test (reopenDoor.test.ts): the wrong door opens and nothing throws.
 */
export function doorToReopen(openAt: MealDoor | undefined, resume: ReadInProgress | undefined): MealDoor | null {
  if (resume?.door === 'chat') return { at: 'chat', listening: resume.listening, resume };
  if (resume?.door === 'photo') return { at: 'photo', photo: resume.photo ?? '', caption: resume.words, resume };
  if (!openAt || openAt.at === 'chat') return null;
  return openAt;
}

/** The sheet over the shelves, when it is what opens: the read to pick up, or the caller's typing/voice door. */
export function describeToReopen(openAt: MealDoor | undefined, resume: ReadInProgress | undefined): Describe | null {
  if (resume?.door === 'describe') return { seed: resume.words, listening: resume.listening, resume };
  if (resume) return null;
  if (openAt?.at === 'chat') return { listening: openAt.listening };
  return null;
}
