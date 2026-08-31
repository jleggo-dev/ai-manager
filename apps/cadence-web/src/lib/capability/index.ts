/**
 * Native capability seam (spec §8). Build PWA-first; ALL native-only calls
 * (HealthKit, push, dictation) go through this interface. The web build uses a
 * browser/no-op implementation; the Capacitor iOS build swaps in a native
 * implementation WITHOUT touching app logic. This is the deciding-constraint
 * isolation that keeps one codebase.
 */

export interface Workout {
  type: string;
  distanceKm?: number;
  durationMin?: number;
  avgHr?: number;
  start: string; // ISO
  /** Stable per-workout id from the platform (HealthKit's workout UUID) — the dedup key that
   *  lets the device re-push its whole window idempotently. */
  id?: string;
  /** The app that originally recorded it (HealthKit's sourceName) — future cross-source dedup. */
  recordedBy?: string;
  /** The recording app's BUNDLE id (HealthKit's sourceBundleId). The display name above is for
   *  people; this one is for the machine — A14's dedup drops rows recorded by our own bundle on
   *  the device once we write workouts, and only the bundle id makes that exact. */
  recordedByBundleId?: string;
}

/** One day's step count, as an aggregated bucket — never the individual samples behind it. */
export interface DailySteps {
  /** ISO date, YYYY-MM-DD, in the DEVICE's calendar — a step day is a wall-clock day. */
  date: string;
  steps: number;
}

export interface HealthCapability {
  isAvailable(): boolean;
  requestPermissions(scopes: string[]): Promise<boolean>;
  getWorkouts(sinceISO: string): Promise<Workout[]>;
  /**
   * Daily step buckets since `sinceISO`, oldest first.
   *
   * Returns `[]` rather than throwing on any failure, and `[]` means "we could not read it" —
   * never "they took no steps". Steps are a strictly-additional signal: a caller must be able to
   * ask for them and still end up with the workouts it would have had without asking.
   */
  getDailySteps(sinceISO: string): Promise<DailySteps[]>;
  getLatestWeightKg(): Promise<number | null>;
  getSleepHours(dateISO: string): Promise<number | null>;
}

export interface PushCapability {
  isAvailable(): boolean;
  register(): Promise<string | null>; // returns device token
}

export interface LocationCapability {
  isAvailable(): boolean;
  getCoarseLocation(): Promise<{ lat: number; lon: number } | null>;
}

/**
 * Speech-to-text for the composer mic. Web uses the Web Speech API; a future
 * Capacitor `native.ts` can swap in platform STT without touching MicButton.
 */
export type DictationResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

export interface DictationSession {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: DictationResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface DictationCapability {
  isAvailable(): boolean;
  createSession(): DictationSession | null;
}

/**
 * On-device scheduled reminders (iOS local notifications). Distinct from `push`: these need no
 * server, no APNs and no network, and they fire exactly on time — but they only know what the
 * app knew when it last ran. Plan reminders belong here; anything requiring server knowledge
 * (a re-plan, a week away, a recap) belongs in `push`.
 */
export interface LocalNotificationsCapability {
  isAvailable(): boolean;
  /** iOS shares one permission with push — granting either covers both. */
  requestPermission(): Promise<boolean>;
  /** Replace ALL Cadence-owned reminders with exactly these. Idempotent. */
  sync(specs: LocalNotificationSpec[]): Promise<number>;
  cancelAll(): Promise<void>;
  pendingCount(): Promise<number>;
}

/**
 * The coach's face on a notification (iOS communication notifications).
 *
 * Donating an `INSendMessageIntent` makes iOS render Cadence's notifications as messages from a
 * person: the chosen portrait replaces the app icon, the icon shrinks to a corner badge, and
 * Cadence appears under "People" in Focus settings so it can be let through Do Not Disturb the
 * way a person is. Web has no equivalent and reports unavailable, so every caller degrades to a
 * plain app-icon notification with no branch of its own.
 */
export interface CoachIdentityCapability {
  isAvailable(): boolean;
  /** Donate the sender identity. Returns whether iOS accepted it. Never throws. */
  donate(input: { senderName: string; avatarBase64: string }): Promise<boolean>;
  /** Register the long-press action categories. Idempotent; safe to call on every sync. */
  registerCategories(): Promise<void>;
}

/** What the watch's scheduler answers about itself. `unavailable` = no WorkoutKit (iOS < 17),
 *  no paired watch, or the web build — the affordance must not render at all in that state. */
export type WatchAuthState = 'notDetermined' | 'restricted' | 'denied' | 'authorized' | 'unavailable';

/** One entry in Apple's scheduled-workouts list, keyed by OUR plan id (= the occurrence id). */
export interface ScheduledWatchWorkout {
  id: string;
  dateISO?: string;
  hour?: number;
  minute?: number;
  complete: boolean;
}

/**
 * The WorkoutKit hand-off (A13 v1): the phone composes the session, Apple's Workout app on the
 * watch runs it. Scheduled, never started — from an iPhone the only route is
 * `WorkoutScheduler.schedule`, so the affordance is "it's on your watch for Thursday", and the
 * result comes back through `health.getWorkouts` carrying the plan id we chose.
 */
export interface WorkoutPlanCapability {
  isAvailable(): boolean;
  /** One round-trip gate for the affordance: scheduler supported AND the current auth state. */
  isSupported(): Promise<{ supported: boolean; state: WatchAuthState }>;
  requestAuthorization(): Promise<WatchAuthState>;
  /** Schedule finished specs (composed + clamped in @cadence/shared). Per-item verdicts. */
  schedule(
    items: Array<{ spec: WorkoutPlanSpec; dateISO: string; hour?: number; minute?: number }>,
  ): Promise<Array<{ id: string; scheduled: boolean; reason?: string }>>;
  listScheduled(): Promise<ScheduledWatchWorkout[]>;
  /** Remove every entry for this plan id — one occurrence, however many times it was scheduled. */
  remove(id: string, dateISO?: string): Promise<number>;
}

/** What the phone can say about the watch app on the other end of WatchConnectivity. */
export interface WatchSyncState {
  /** WatchConnectivity exists and this device supports a session at all (iPhone, not iPad). */
  supported: boolean;
  /** A watch is paired to this phone. */
  paired: boolean;
  /** OUR watch app is installed on it. Nothing is worth sending when this is false. */
  installed: boolean;
}

/**
 * The committed week, pushed to our own watch app (W2 — the sync slice).
 *
 * Distinct from `workoutPlan`, which schedules into APPLE's Workout app and is about one session.
 * This carries our whole projected week to our own app, so the wrist can show the plan and run
 * the sessions a wrist is good at.
 *
 * `push` takes the finished payload from `buildWatchWeek` and hands it to
 * `updateApplicationContext` — a single latest-state slot, which is exactly the right shape for
 * "here is the week": it coalesces (only the newest matters), it survives the watch being off,
 * and it does not queue a backlog of stale weeks behind a watch that was in a drawer.
 */
export interface WatchSyncCapability {
  isAvailable(): boolean;
  /** One round-trip gate. Every failure answers no, so a caller never sends into a void. */
  getState(): Promise<WatchSyncState>;
  /** Push the week. Answers whether WatchConnectivity accepted it — never throws. */
  push(payload: WatchWeekPayload): Promise<boolean>;
  /**
   * Sessions finished on the watch, waiting to be sent to the API.
   *
   * An outbox rather than a callback, because WatchConnectivity delivers to the NATIVE app: a log
   * can arrive while the webview is not running at all. The phone holds them until the web layer
   * has actually stored each one and acknowledges it by id — so an app killed mid-POST retries on
   * next launch instead of dropping what somebody did.
   */
  pendingLogs(): Promise<WatchPendingLog[]>;
  /** Forget logs the API has accepted. Anything unacknowledged is delivered again. */
  ackLogs(ids: string[]): Promise<void>;
  /** Fires when a log arrives while the app IS running, so the inbox drains without polling. */
  onLogReceived(handler: () => void): () => void;
  /**
   * Send the coach's chosen portrait to the watch.
   *
   * A FILE transfer, not application context: the portraits are 20-30KB JPEGs, and base64 in the
   * week's context would eat most of its byte budget to carry a picture that changes almost never.
   * `transferFile` is built for this — background delivery, generous limits, and independent of
   * the week, so a portrait cannot cost a plan sync.
   *
   * `faceId` rides along so the watch can ignore a portrait it already has.
   */
  pushPortrait(faceId: string, jpegBase64: string): Promise<boolean>;
}

/** One queued watch log. `payload` is the raw JSON the watch sent — asserted server-side by
 *  `normalizeWatchLog`, never trusted here. */
export interface WatchPendingLog {
  id: string;
  payload: unknown;
}

export interface Capabilities {
  health: HealthCapability;
  push: PushCapability;
  localNotifications: LocalNotificationsCapability;
  coachIdentity: CoachIdentityCapability;
  location: LocationCapability;
  dictation: DictationCapability;
  workoutPlan: WorkoutPlanCapability;
  watchSync: WatchSyncCapability;
}

import type { LocalNotificationSpec, WatchWeekPayload, WorkoutPlanSpec } from '@cadence/shared';
import { Capacitor } from '@capacitor/core';
import { webCapabilities } from './web.ts';
import { nativeCapabilities } from './native.ts';

/**
 * Active capability set, resolved at runtime: the Capacitor iOS shell gets the native
 * implementations (HealthKit, APNs); every web context keeps the browser/no-op set.
 * `isNativePlatform()` is false in plain browsers, so the web bundle behaves exactly as before.
 */
export const capabilities: Capabilities = Capacitor.isNativePlatform() ? nativeCapabilities : webCapabilities;
