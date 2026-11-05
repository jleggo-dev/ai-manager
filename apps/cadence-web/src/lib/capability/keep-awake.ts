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

const rawBrowserKeepAwake: KeepAwakeCapability = {
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

const rawNativeKeepAwake: KeepAwakeCapability = {
  set: async (on) => {
    try {
      await KeepAwakePlugin.set({ on });
    } catch {
      await rawBrowserKeepAwake.set(on);
    }
  },
};

/**
 * Reference-counted over a single switch. Two things hold the screen: the running clock, from the
 * app root (features/walkthrough/useClockKeepAwake.ts), and the metronome while it clicks. The
 * switch underneath is one bit, so without a count the metronome stopping mid-timer would drop the
 * timer's hold. `set(true)` counts a holder and takes the lock at one; `set(false)` lets a holder
 * go and releases the lock at zero; a release with nobody holding is ignored, never counted below
 * zero.
 */
export function countedKeepAwake(inner: KeepAwakeCapability): KeepAwakeCapability {
  let holders = 0;
  return {
    set: async (on) => {
      if (on) {
        holders += 1;
        if (holders === 1) await inner.set(true);
      } else {
        if (holders === 0) return;
        holders -= 1;
        if (holders === 0) await inner.set(false);
      }
    },
  };
}

export const browserKeepAwake: KeepAwakeCapability = countedKeepAwake(rawBrowserKeepAwake);
export const nativeKeepAwake: KeepAwakeCapability = countedKeepAwake(rawNativeKeepAwake);
