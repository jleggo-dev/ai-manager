import { registerPlugin } from '@capacitor/core';
import type { WorkoutPlanSpec } from '@cadence/shared';
import type { ScheduledWatchWorkout, WatchAuthState, WorkoutPlanCapability } from './index.ts';

/**
 * The local Swift bridge to WorkoutKit (ios/App/App/CadenceWorkoutPlan). Same lazy-resolution
 * contract as CadenceCoachIdentity: `registerPlugin` succeeds even when the plugin was never
 * compiled in, and the failure arrives at CALL time — so every method below catches and answers
 * with the honest degraded value. A missing plugin costs the watch hand-off, never the session.
 */
const WorkoutPlanPlugin = registerPlugin<{
  isSupported(): Promise<{ supported: boolean; state: WatchAuthState }>;
  requestAuthorization(): Promise<{ state: WatchAuthState }>;
  schedule(options: {
    items: Array<{ spec: WorkoutPlanSpec; dateISO: string; hour?: number; minute?: number }>;
  }): Promise<{ scheduled: number; results: Array<{ id: string; scheduled: boolean; reason?: string }> }>;
  listScheduled(): Promise<{ items: ScheduledWatchWorkout[] }>;
  remove(options: { id: string; dateISO?: string }): Promise<{ matched: number }>;
}>('CadenceWorkoutPlan');

/**
 * Native implementation of the WorkoutKit hand-off.
 *
 * Every judgement about WHAT to schedule was made before this file: the spec arrives composed and
 * clamped from `@cadence/shared`'s `composeWorkoutPlan`, and the Swift side decodes it without
 * opinions. What this layer owns is the failure posture — `supported: false` when anything at all
 * goes wrong, because the ONLY consumer of that answer is "may the affordance render", and a
 * button that renders on a broken bridge is a dead button.
 */
export const nativeWorkoutPlan: WorkoutPlanCapability = {
  isAvailable: () => true,

  isSupported: async () => {
    try {
      return await WorkoutPlanPlugin.isSupported();
    } catch {
      return { supported: false, state: 'unavailable' };
    }
  },

  requestAuthorization: async () => {
    try {
      return (await WorkoutPlanPlugin.requestAuthorization()).state;
    } catch {
      return 'unavailable';
    }
  },

  schedule: async (items) => {
    if (!items.length) return [];
    try {
      return (await WorkoutPlanPlugin.schedule({ items })).results;
    } catch {
      // The bridge itself failed (plugin missing, decode crash) — report every item unscheduled
      // rather than throwing, so a caller can tell the user plainly instead of breaking the sheet.
      return items.map((i) => ({ id: i.spec.id, scheduled: false, reason: 'bridge unavailable' }));
    }
  },

  listScheduled: async () => {
    try {
      return (await WorkoutPlanPlugin.listScheduled()).items;
    } catch {
      return [];
    }
  },

  remove: async (id, dateISO) => {
    try {
      return (await WorkoutPlanPlugin.remove({ id, ...(dateISO ? { dateISO } : {}) })).matched;
    } catch {
      return 0;
    }
  },
};
