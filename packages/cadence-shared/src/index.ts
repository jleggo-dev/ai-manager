/**
 * @cadence/shared — Cadence domain types.
 *
 * Source of truth: cadence-spec.md §5 (data model) and §C4 (Broker job
 * contracts). IDs are app-generated. The Broker extracts into these shapes;
 * the app asserts them before committing (never trust raw model output).
 *
 * Types are split by concern under `./types/`; this barrel re-exports the full
 * public surface so consumers keep importing from `@cadence/shared`.
 */

export * from './types/baseline.ts';
export * from './types/goals.ts';
export * from './types/equipment.ts';
export * from './types/plan.ts';
export * from './types/occurrence.ts';
export * from './types/progress.ts';
export * from './types/nutrition.ts';
export * from './types/food.ts';
export * from './types/dietary.ts';
export * from './dietary-safety.ts';
export * from './types/episode.ts';
export * from './types/health.ts';
export * from './types/conversation.ts';
export * from './types/broker-contracts.ts';
export * from './types/tripwires.ts';
export * from './types/streak.ts';
export * from './types/rewards.ts';
export * from './coach-face.ts';
export * from './coach-picks.ts';
export * from './session-feedback.ts';
export * from './walkthrough.ts';
export * from './tool-catalog.ts';
export * from './breathing.ts';
export * from './interval.ts';
export * from './meditate.ts';
export * from './grounding.ts';
export * from './feelings.ts';
export * from './now-menu.ts';
export * from './journal.ts';
export * from './freewrite.ts';
export * from './journal-export.ts';
export * from './local-notifications.ts';
export * from './notifications/index.ts';
