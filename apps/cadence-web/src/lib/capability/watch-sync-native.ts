import { registerPlugin } from '@capacitor/core';
import type { WatchWeekPayload } from '@cadence/shared';
import type { WatchPendingLog, WatchSyncCapability, WatchSyncState } from './index.ts';

/**
 * The local Swift bridge to WatchConnectivity (ios/App/App/CadenceWatchSync). Same lazy-resolution
 * contract as the other local plugins: `registerPlugin` succeeds even when the plugin was never
 * compiled in, and the failure arrives at CALL time — so every method below catches and answers
 * with the honest degraded value.
 */
const WatchSyncPlugin = registerPlugin<{
  getState(): Promise<WatchSyncState>;
  push(options: { payload: string }): Promise<{ delivered: boolean; reason?: string }>;
  pendingLogs(): Promise<{ logs: Array<{ id: string; payload: string }> }>;
  ackLogs(options: { ids: string[] }): Promise<void>;
  addListener(event: 'logReceived', handler: () => void): Promise<{ remove: () => Promise<void> }>;
  pushPortrait(options: { faceId: string; jpegBase64: string }): Promise<{ sent: boolean }>;
}>('CadenceWatchSync');

/** No watch, no session, no point. Every failure path lands here. */
const NO_WATCH: WatchSyncState = { supported: false, paired: false, installed: false };

/**
 * Native implementation of the watch sync, both directions.
 *
 * Out: the projected week, as a JSON **string**. Capacitor would marshal a dictionary happily, but
 * WatchConnectivity's application context accepts only property-list types, and a JS object
 * arrives as `JSObject` with `null`s and nested arrays that must each be sanitised into that
 * world — one missed `null` and the whole context throws. One string cannot be malformed.
 *
 * Back: finished sessions, as an outbox with explicit acknowledgement. Logs arrive at the NATIVE
 * app and may land while the webview is not running, so they are held on the phone until this
 * layer confirms the API stored each one.
 *
 * Failure posture: never throw. A failed sync costs the wrist its freshness; a failed drain costs
 * a retry on the next launch. Neither may break a screen the user is looking at.
 */
export const nativeWatchSync: WatchSyncCapability = {
  isAvailable: () => true,

  getState: async () => {
    try {
      return await WatchSyncPlugin.getState();
    } catch {
      return NO_WATCH;
    }
  },

  push: async (payload: WatchWeekPayload) => {
    try {
      const { delivered } = await WatchSyncPlugin.push({ payload: JSON.stringify(payload) });
      return delivered;
    } catch {
      return false;
    }
  },

  pendingLogs: async (): Promise<WatchPendingLog[]> => {
    try {
      const { logs } = await WatchSyncPlugin.pendingLogs();
      return logs
        .map((row) => {
          try {
            return { id: row.id, payload: JSON.parse(row.payload) as unknown };
          } catch {
            // Unparseable JSON from the watch. Returning it with a null payload lets the caller
            // acknowledge and drop it rather than retrying a poison row forever.
            return { id: row.id, payload: null };
          }
        })
        .filter((row): row is WatchPendingLog => row.id.length > 0);
    } catch {
      return [];
    }
  },

  ackLogs: async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await WatchSyncPlugin.ackLogs({ ids });
    } catch {
      // Unacknowledged logs are delivered again — at-least-once is the contract, and the server
      // side is idempotent on the watch's own finish time.
    }
  },

  pushPortrait: async (faceId: string, jpegBase64: string) => {
    try {
      const { sent } = await WatchSyncPlugin.pushPortrait({ faceId, jpegBase64 });
      return sent;
    } catch {
      return false;
    }
  },

  onLogReceived: (handler: () => void) => {
    let remove: (() => Promise<void>) | null = null;
    let cancelled = false;
    void WatchSyncPlugin.addListener('logReceived', handler)
      .then((h) => {
        if (cancelled) void h.remove();
        else remove = h.remove;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      void remove?.();
    };
  },
};
