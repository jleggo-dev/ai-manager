/**
 * The nudge catalog — one place that owns which notifications exist, what they say, and how many
 * of them a user has asked for.
 *
 * Shared on purpose. The tier decides what the SERVER may push and what the DEVICE may schedule;
 * the copy is the same copy either way. Two copies of this, one per side, is how a brand rule gets
 * fixed in one place and not the other, and the user finds out on a lock screen.
 */

export * from './kinds.ts';
export * from './voice.ts';
export * from './variant.ts';
export * from './pillar.ts';
export * from './format.ts';
export * from './actions.ts';
export * from './copy.ts';
export * from './build.ts';
