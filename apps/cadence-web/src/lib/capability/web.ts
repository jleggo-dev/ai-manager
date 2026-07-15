import type { Capabilities } from './index.ts';

/**
 * Web no-op capabilities. HealthKit/push/native-location are unreachable in a
 * pure web/PWA context, so these degrade gracefully. The native (Capacitor)
 * implementation replaces this object on iOS.
 */
export const webCapabilities: Capabilities = {
  health: {
    isAvailable: () => false,
    requestPermissions: async () => false,
    getWorkouts: async () => [],
    getLatestWeightKg: async () => null,
    getSleepHours: async () => null,
  },
  push: {
    isAvailable: () => false,
    register: async () => null,
  },
  location: {
    isAvailable: () => 'geolocation' in navigator,
    getCoarseLocation: () =>
      new Promise((resolve) => {
        if (!('geolocation' in navigator)) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: false, timeout: 5000 },
        );
      }),
  },
};
