/* ════════════════════════════════════════════════════════════════
   §5.7 Disrupted episode
   ════════════════════════════════════════════════════════════════ */

import type { Equipment } from './equipment.ts';
import type { Activity } from './plan.ts';

export interface EpisodeOverride {
  activity_id: string;
  swap_to?: string;
  action?: 'pause';
}

/**
 * A disrupted episode is an ADDITIVE temporary overlay, not a rewrite of the base
 * plan (user direction): it makes space to "do what you can" guilt-free, protects
 * momentum (a detour never resets progress to zero), and the base plan resumes
 * untouched on `end`. `type: 'custom'` covers
 * non-fitness life events (a wedding, a bereavement) where tone matters more than
 * equipment. `available_equipment` is confirmed for the episode — e.g. the user
 * photographs a hotel gym and the Scribe/Coach parses it into equipment.
 */
export interface DisruptedEpisode {
  episode_id: string;
  type: 'travel' | 'illness' | 'injury' | 'recovery' | 'custom';
  start: string;
  end: string;
  /** Equipment available only during the episode (e.g. from a hotel-gym photo). */
  available_equipment?: Partial<Equipment>[];
  constraints: Record<string, unknown>;
  /** Optional lighter temporary activities for the episode — added, not substituted. */
  temp_activities?: Partial<Activity>[];
  /** Per-base-activity tweaks (swap/pause) while the episode is active. */
  overrides: EpisodeOverride[];
  /** Momentum is protected (progress never resets) and nudge tone softened while active. */
  protect_momentum: boolean;
  tone?: 'gentle' | 'supportive';
  status: 'active' | 'ended';
}
