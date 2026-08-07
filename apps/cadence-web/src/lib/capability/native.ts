import { Health } from 'capacitor-health';
import { PushNotifications } from '@capacitor/push-notifications';
import { Geolocation } from '@capacitor/geolocation';
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
 * future path). Push = APNs via @capacitor/push-notifications. Location = CoreLocation via
 * @capacitor/geolocation (not WKWebView navigator.geolocation — capacitor:// is not a secure
 * origin). Dictation reuses web: WKWebView has no Web Speech API so it correctly reports unavailable.
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
  location: {
    isAvailable: () => true,
    // CoreLocation via the Capacitor plugin, NOT WKWebView's navigator.geolocation: the shell is
    // served from capacitor://localhost, which iOS does not treat as a secure origin, so the web
    // API is unreliable there. Going through the plugin also gives a real permission state
    // (checkPermissions) instead of only a success/failure callback, and keeps the prompt and
    // accuracy behaviour identical to any other iOS app.
    getCoarseLocation: async () => {
      try {
        const status = await Geolocation.checkPermissions();
        if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
          const asked = await Geolocation.requestPermissions({ permissions: ['coarseLocation'] });
          if (asked.location !== 'granted' && asked.coarseLocation !== 'granted') return null;
        }
        // Coarse is all Cadence needs (weather + timezone); low accuracy is faster and colder on battery.
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10_000 });
        return { lat: pos.coords.latitude, lon: pos.coords.longitude };
      } catch {
        return null;
      }
    },
  },
  dictation: webCapabilities.dictation,
};
