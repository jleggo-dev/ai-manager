import { registerPlugin } from '@capacitor/core';
import type { KeepAwakeCapability } from './index.ts';

/**
 * The browser's Screen Wake Lock, where there is one. The lock is dropped by the browser whenever
 * the tab is hidden, so `set(true)` while already held re-requests rather than trusting the old
 * sentinel. Everything fails soft: no API, a refusal, or a release error leaves the screen to its
 * own timeout.
 */
type Sentinel = { release(): Promise<void>; released?: boolean };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

let held: Sentinel | null = null;

export const browserKeepAwake: KeepAwakeCapability = {
  set: async (on) => {
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    try {
      if (on) {
        if (!api || (held && !held.released)) return;
        held = await api.request('screen');
      } else {
        const was = held;
        held = null;
        await was?.release();
      }
    } catch {
      /* refused or unsupported — the screen keeps its own timeout */
    }
  },
};

/**
 * The local Swift bridge (ios/App/App/CadenceKeepAwakePlugin.swift) — `isIdleTimerDisabled`, the
 * one switch that holds an iOS screen on whatever the webview supports. Same lazy-resolution
 * contract as the other local plugins: a missing plugin fails at CALL time, and then the browser
 * lock is tried instead.
 */
const KeepAwakePlugin = registerPlugin<{ set(options: { on: boolean }): Promise<void> }>('CadenceKeepAwake');

export const nativeKeepAwake: KeepAwakeCapability = {
  set: async (on) => {
    try {
      await KeepAwakePlugin.set({ on });
    } catch {
      await browserKeepAwake.set(on);
    }
  },
};
