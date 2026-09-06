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
    getDailySteps: async () => [],
    getLatestWeightKg: async () => null,
    getSleepHours: async () => null,
  },
  push: {
    isAvailable: () => false,
    register: async () => null,
    // No APNs in a browser, so nothing ever arrives — the no-op unsubscribe keeps App.tsx's
    // wiring branch-free (subscribe everywhere, fire only where pushes exist).
    onNotification: () => () => {},
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
  localNotifications: {
    isAvailable: () => false,
    requestPermission: async () => false,
    sync: async () => 0,
    cancelAll: async () => {},
    pendingCount: async () => 0,
    // A web timer keeps time from the wall clock and chimes when the tab is next awake; there is
    // no way to ring a closed tab, so the alarm reports it could not be set rather than pretending.
    scheduleAlarm: async () => false,
    cancelAlarm: async () => {},
  },
  // A browser has no lock screen to draw on. Unavailable means the timer never tries.
  liveActivity: {
    isAvailable: () => false,
    start: async () => false,
    pause: async () => {},
    end: async () => {},
  },
  // No web equivalent: communication notifications are an iOS system feature, and there is no
  // browser API that makes a notification look like it came from a person.
  coachIdentity: {
    isAvailable: () => false,
    donate: async () => false,
    registerCategories: async () => {},
  },
  // A browser has no watch to schedule onto. isAvailable() === false keeps the affordance from
  // rendering at all, which is the contract every consumer relies on.
  workoutPlan: {
    isAvailable: () => false,
    isSupported: async () => ({ supported: false, state: 'unavailable' }),
    requestAuthorization: async () => 'unavailable',
    schedule: async () => [],
    listScheduled: async () => [],
    remove: async () => 0,
  },
  // A browser has no watch on the other end. Same contract as workoutPlan: unavailable means
  // callers skip the push entirely rather than building a payload nobody receives.
  watchSync: {
    isAvailable: () => false,
    getState: async () => ({ supported: false, paired: false, installed: false }),
    push: async () => false,
    pendingLogs: async () => [],
    ackLogs: async () => {},
    onLogReceived: () => () => {},
    pushPortrait: async () => false,
  },
  dictation: {
    isAvailable: () => getSpeechRecognitionCtor() !== null,
    createSession: () => {
      const Ctor = getSpeechRecognitionCtor();
      return Ctor ? new Ctor() : null;
    },
  },
};
