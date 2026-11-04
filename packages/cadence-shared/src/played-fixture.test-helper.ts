/**
 * The owner's 2026-11-02 gym session, the case walkthrough v3 Phase 6 is built on: presses and
 * rows written one after the other but trained alternating, and three 45-second dead hangs that
 * cannot be done back to back. Shared by the played-* tests.
 */
import type { WalkthroughStep } from './walkthrough.ts';

export const GYM: WalkthroughStep[] = [
  { id: 's1', title: 'Warm-up', minutes: 6, tool: { kind: 'read' }, skippable: true },
  { id: 's2', title: 'Pull-ups', minutes: 6, tool: { kind: 'reps', sets: 3, reps: 5 }, skippable: true },
  { id: 's3', title: 'Bench press', minutes: 9, tool: { kind: 'reps', sets: 3, reps: 8, load: '95 lb' }, skippable: true },
  { id: 's4', title: 'Dumbbell row', minutes: 9, tool: { kind: 'reps', sets: 3, reps: 10, load: '40 lb' }, skippable: true },
  { id: 's5', title: 'Dead hang', minutes: 3, tool: { kind: 'timer', seconds: 45, chime: true, sets: 3 }, skippable: true },
  {
    id: 's6',
    title: 'Farmer carry',
    minutes: 6,
    tool: { kind: 'timer', seconds: 45, chime: true, sets: 3, load: '2×40 lb' },
    skippable: true,
  },
  {
    id: 's7',
    title: 'Hip thrust',
    minutes: 4,
    tool: { kind: 'reps', sets: 2, reps: 12, load: '40 lb' },
    skippable: true,
    swapped_from: 'Glute bridge',
  },
  {
    id: 's8',
    title: 'Abs circuit',
    minutes: 8,
    tool: {
      kind: 'circuit',
      rounds: 3,
      exercises: [
        { name: 'Plank', seconds: 30 },
        { name: 'Dead bug', reps: 8 },
        { name: 'Side plank', seconds: 20 },
        { name: 'Hollow hold', seconds: 20 },
      ],
    },
    skippable: true,
  },
];

export const byTitle = (title: string): WalkthroughStep => {
  const step = GYM.find((s) => s.title === title);
  if (!step) throw new Error(`no fixture step titled ${title}`);
  return step;
};
