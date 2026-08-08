import type { Capabilities, DictationSession } from './index.ts';

type SpeechRecognitionCtor = new () => DictationSession;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Web capabilities. HealthKit/push are unreachable in a pure web/PWA context;
 * location and dictation use browser APIs when present. The native (Capacitor)
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
  // Reminders are native-only. The Web Notifications API can only fire while a page is open,
  // and the Notification Triggers proposal (scheduled, page-closed) was never shipped by any
  // browser — so a web "implementation" would be a reminder that silently never arrives.
  // isAvailable() === false lets callers show the right thing instead of failing quietly.
  reminders: {
    isAvailable: () => false,
    requestPermission: async () => false,
    sync: async () => 0,
    cancelAll: async () => {},
    pendingCount: async () => 0,
  },
  dictation: {
    isAvailable: () => getSpeechRecognitionCtor() !== null,
    createSession: () => {
      const Ctor = getSpeechRecognitionCtor();
      return Ctor ? new Ctor() : null;
    },
  },
};
