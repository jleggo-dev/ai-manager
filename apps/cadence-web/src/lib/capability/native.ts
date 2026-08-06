import { Health } from 'capacitor-health';
import { PushNotifications } from '@capacitor/push-notifications';
import type { Capabilities, Workout } from './index.ts';
import { webCapabilities } from './web.ts';

/** Shape of one workout row from capacitor-health's queryWorkouts. */
interface PluginWorkout {
  workoutType?: string;
  startDate: string;
  endDate?: string;
  duration?: number; // seconds
  distance?: number; // meters
  avgHeartRate?: number;
}

function toSeamWorkout(w: PluginWorkout): Workout {
  return {
    type: w.workoutType ?? 'workout',
    start: w.startDate,
    ...(typeof w.distance === 'number' ? { distanceKm: Math.round((w.distance / 1000) * 100) / 100 } : {}),
    ...(typeof w.duration === 'number' ? { durationMin: Math.round(w.duration / 60) } : {}),
    ...(typeof w.avgHeartRate === 'number' ? { avgHr: Math.round(w.avgHeartRate) } : {}),
  };
}

/** How long to wait for APNs to hand back a device token before giving up. */
const PUSH_REGISTER_TIMEOUT_MS = 10_000;

/**
 * Native (Capacitor iOS) capabilities. Health = HealthKit via capacitor-health (workouts only —
 * the plugin has no weight/sleep queries yet, so those stay null; a custom Swift extension is the
 * future path). Push = APNs via @capacitor/push-notifications. Location + dictation reuse the web
 * implementations: WKWebView geolocation works behind NSLocationWhenInUseUsageDescription, and
 * WKWebView has no Web Speech API so dictation correctly reports unavailable (MicButton hides).
 */
export const nativeCapabilities: Capabilities = {
  health: {
    isAvailable: () => true,
    requestPermissions: async () => {
      const res = await Health.requestHealthPermissions({
        permissions: ['READ_WORKOUTS', 'READ_DISTANCE', 'READ_ACTIVE_CALORIES', 'READ_HEART_RATE'],
      });
      // iOS never reveals read-permission state (HealthKit privacy design) — the request call
      // succeeding is all we get; queries simply return empty for denied types.
      return res.permissions.some((p) => Object.values(p).some(Boolean));
    },
    getWorkouts: async (sinceISO: string) => {
      const res = await Health.queryWorkouts({
        startDate: sinceISO,
        endDate: new Date().toISOString(),
        includeHeartRate: false,
        includeRoute: false,
        includeSteps: false,
      });
      return (res.workouts as PluginWorkout[]).map(toSeamWorkout);
    },
    getLatestWeightKg: async () => null,
    getSleepHours: async () => null,
  },
  push: {
    isAvailable: () => true,
    register: async () => {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') return null;
      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), PUSH_REGISTER_TIMEOUT_MS);
        void PushNotifications.addListener('registration', (token) => {
          clearTimeout(timer);
          resolve(token.value);
        });
        void PushNotifications.addListener('registrationError', () => {
          clearTimeout(timer);
          resolve(null);
        });
        void PushNotifications.register();
      });
    },
  },
  location: webCapabilities.location,
  dictation: webCapabilities.dictation,
};
