/**
 * Native capability seam (spec §8). Build PWA-first; ALL native-only calls
 * (HealthKit, push) go through this interface. The web build uses a no-op
 * implementation; the Capacitor iOS build swaps in a native implementation
 * WITHOUT touching app logic. This is the deciding-constraint isolation that
 * keeps one codebase.
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

export interface Capabilities {
  health: HealthCapability;
  push: PushCapability;
  location: LocationCapability;
}
