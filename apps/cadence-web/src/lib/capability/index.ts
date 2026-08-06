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
}

export interface HealthCapability {
  isAvailable(): boolean;
  requestPermissions(scopes: string[]): Promise<boolean>;
  getWorkouts(sinceISO: string): Promise<Workout[]>;
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

export interface Capabilities {
  health: HealthCapability;
  push: PushCapability;
  location: LocationCapability;
  dictation: DictationCapability;
}

import { Capacitor } from '@capacitor/core';
import { webCapabilities } from './web.ts';
import { nativeCapabilities } from './native.ts';

/**
 * Active capability set, resolved at runtime: the Capacitor iOS shell gets the native
 * implementations (HealthKit, APNs); every web context keeps the browser/no-op set.
 * `isNativePlatform()` is false in plain browsers, so the web bundle behaves exactly as before.
 */
export const capabilities: Capabilities = Capacitor.isNativePlatform() ? nativeCapabilities : webCapabilities;
