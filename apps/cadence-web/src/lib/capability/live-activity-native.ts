import { registerPlugin } from '@capacitor/core';
import type { LiveActivityCapability, TimerActivityStart } from './index.ts';

/**
 * The local Swift bridge to ActivityKit (ios/App/App/CadenceLiveActivity). Same lazy-resolution
 * contract as the other local plugins: `registerPlugin` succeeds even when the plugin was never
 * compiled in, and the failure arrives at CALL time — so every method below catches and answers
 * the honest degraded value. A missing plugin costs the lock-screen clock, never the timer.
 */
const LiveActivityPlugin = registerPlugin<{
  isAvailable(): Promise<{ available: boolean }>;
  start(options: TimerActivityStart): Promise<{ started: boolean }>;
  update(options: { paused: boolean; baseSeconds: number }): Promise<void>;
  end(): Promise<void>;
}>('CadenceLiveActivity');

export const nativeLiveActivity: LiveActivityCapability = {
  isAvailable: () => true,

  start: async (state) => {
    try {
      return (await LiveActivityPlugin.start(state)).started;
    } catch {
      return false;
    }
  },

  pause: async (baseSeconds) => {
    try {
      await LiveActivityPlugin.update({ paused: true, baseSeconds });
    } catch {
      /* no activity to pause — nothing to do */
    }
  },

  end: async () => {
    try {
      await LiveActivityPlugin.end();
    } catch {
      /* already gone */
    }
  },
};
