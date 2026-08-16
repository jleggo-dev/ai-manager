import { Health, type HealthPermission } from 'capacitor-health';
import { registerPlugin } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { NUDGE_CATEGORIES, type LocalNotificationSpec } from '@cadence/shared';
import { Geolocation } from '@capacitor/geolocation';
import type { Capabilities, Workout } from './index.ts';
import { grantedFromPermissionResponse } from './health-permissions.ts';
import { readDailySteps } from './health-steps.ts';
import { recordedDistanceKm } from './workout-distance.ts';
import { webCapabilities } from './web.ts';

/**
 * The local Swift plugin that donates the coach's portrait (ios/App/App/CadenceCoachIdentity).
 * `registerPlugin` resolves lazily, so a build without the plugin compiled in fails at CALL time
 * rather than at import — which is why every use below is wrapped and falls back silently.
 */
const CoachIdentity = registerPlugin<{
  donate(options: { senderName: string; avatarBase64: string }): Promise<{ donated: boolean }>;
  /**
   * Schedules with the donated identity applied. Separate from `donate` because
   * `UNNotificationContent.updating(from:)` — the call that actually attaches the portrait — can
   * only be made on the content about to be posted, and for a LOCAL notification that content is
   * built by whoever schedules it. `decorated: false` means no donation was in effect, and the
   * caller then schedules the ordinary way rather than posting undecorated notifications it
   * believes are decorated.
   */
  scheduleWithIdentity(options: { notifications: LocalNotificationSpec[] }): Promise<{
    scheduled: number;
    decorated: boolean;
  }>;
}>('CadenceCoachIdentity');

/**
 * One spec → one Capacitor notification.
 *
 * The two trigger shapes are not interchangeable. A weekly repeat occupies ONE of the OS's 64
 * pending slots and fires forever, which is what keeps a full plan far below the ceiling. A
 * one-shot is how anything that depends on TODAY works at all — yesterday's count, a waypoint
 * date, whether something is still unlogged this evening — none of which a calendar repeat can
 * know, because it was scheduled once and fires blind from then on.
 */
function toNotification(r: LocalNotificationSpec): LocalNotificationSchema {
  const base = {
    id: r.id,
    title: r.title,
    body: r.body,
    // Carries the pre-composed lighter day and the nudge's own kind, so an action button never
    // has to work anything out with the app cold and possibly offline.
    extra: { kind: r.kind, activityId: r.activityId, ...(r.extra ?? {}) },
    ...(r.actionTypeId ? { actionTypeId: r.actionTypeId } : {}),
  };
  if (r.weekday != null) {
    return {
      ...base,
      schedule: { on: { weekday: r.weekday, hour: r.hour, minute: r.minute }, repeats: true, allowWhileIdle: true },
    };
  }
  // A one-shot's date is the DEVICE's calendar day, so building it with the local Date constructor
  // is correct here — the same wall-clock time the builder clamped against quiet hours.
  const [y, m, d] = (r.date ?? '').split('-').map(Number);
  return {
    ...base,
    schedule: { at: new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, r.hour, r.minute), allowWhileIdle: true },
  };
}

/** Shape of one workout row from capacitor-health's queryWorkouts. */
interface PluginWorkout {
  workoutType?: string;
  startDate: string;
  endDate?: string;
  duration?: number; // seconds
  distance?: number; // meters
  avgHeartRate?: number;
  /** HealthKit's per-workout UUID — present on iOS, optional in the plugin's own types. */
  id?: string;
  /** The recording app's display name (e.g. "Strava", "Apple Watch"). */
  sourceName?: string;
}

function toSeamWorkout(w: PluginWorkout): Workout {
  // A 0 here is the plugin's `?? 0` for "HealthKit had no distance", not a real zero — see
  // workout-distance.ts. The session is kept either way; only the distance goes missing.
  const km = recordedDistanceKm(w.distance);
  return {
    type: w.workoutType ?? 'workout',
    start: w.startDate,
    ...(km != null ? { distanceKm: km } : {}),
    ...(typeof w.duration === 'number' ? { durationMin: Math.round(w.duration / 60) } : {}),
    ...(typeof w.avgHeartRate === 'number' ? { avgHr: Math.round(w.avgHeartRate) } : {}),
    ...(w.id ? { id: w.id } : {}),
    ...(w.sourceName ? { recordedBy: w.sourceName } : {}),
  };
}

/** How long to wait for APNs to hand back a device token before giving up. */
const PUSH_REGISTER_TIMEOUT_MS = 10_000;

/**
 * Everything Cadence reads from Apple Health, in one list so the request and any later re-request
 * can never drift apart.
 *
 * READ_STEPS joined this set after people had already granted the other four. iOS does not
 * re-prompt for a newly-added type, so existing installs need the one-time re-ask in
 * health-steps.ts — see that file for why an empty step read is ambiguous rather than conclusive.
 */
const HEALTH_PERMISSIONS: HealthPermission[] = [
  'READ_WORKOUTS',
  'READ_DISTANCE',
  'READ_ACTIVE_CALORIES',
  'READ_HEART_RATE',
  'READ_STEPS',
];

/** Whether the one-time steps re-ask has happened. User-scoped (see features/auth/localUserState). */
const STEPS_ASKED_KEY = 'cadence.healthStepsAsked';

const readFlag = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage disabled — worst case we ask once more, never a broken read
  }
};

/**
 * Native (Capacitor iOS) capabilities. Health = HealthKit via capacitor-health: workouts, plus
 * daily steps as aggregated buckets (the plugin still has no weight/sleep queries, so those stay
 * null; a custom Swift extension is the future path). Push = APNs via @capacitor/push-notifications. Location = CoreLocation via
 * @capacitor/geolocation (not WKWebView navigator.geolocation — capacitor:// is not a secure
 * origin).
 *
 * Dictation reuses the web implementation, and the note that used to sit here — "WKWebView has no
 * Web Speech API so it correctly reports unavailable" — was simply false. WKWebView DOES expose
 * `webkitSpeechRecognition`, so feature detection passes and the mic button renders. What was
 * missing was permission to use it: the Info.plist carried no NSMicrophoneUsageDescription or
 * NSSpeechRecognitionUsageDescription, so iOS refused the request before it could be shown, and
 * the button did nothing on all nine of its render sites. Those strings are now there.
 */
export const nativeCapabilities: Capabilities = {
  health: {
    isAvailable: () => true,
    requestPermissions: async () => {
      const res = await Health.requestHealthPermissions({ permissions: HEALTH_PERMISSIONS });
      // A fresh grant covers steps too, so the one-time re-ask has nothing left to do. Recording
      // it here is what stops a genuinely step-less person meeting a second sheet on next launch.
      try {
        window.localStorage.setItem(STEPS_ASKED_KEY, '1');
      } catch {
        /* storage disabled — see readFlag */
      }
      // Shape-tolerant on purpose: the plugin's types promise an array and iOS does not send one,
      // so reading it directly threw before a single workout was ever fetched. See
      // health-permissions.ts — on iOS this answer carries no information anyway.
      return grantedFromPermissionResponse(res);
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
    // Aggregated DAY buckets, never raw samples: ~90 numbers instead of the tens of thousands of
    // individual step records behind them, and the only shape the digest has any use for.
    getDailySteps: (sinceISO: string) =>
      readDailySteps(sinceISO, {
        queryDailySteps: async (range) =>
          (await Health.queryAggregated({ ...range, dataType: 'steps', bucket: 'day' })).aggregatedData,
        requestSteps: () => Health.requestHealthPermissions({ permissions: ['READ_STEPS'] }),
        hasAskedForSteps: () => readFlag(STEPS_ASKED_KEY) === '1',
        markAskedForSteps: () => {
          try {
            window.localStorage.setItem(STEPS_ASKED_KEY, '1');
          } catch {
            /* storage disabled — see readFlag */
          }
        },
      }),
    getLatestWeightKg: async () => null,
    getSleepHours: async () => null,
  },
  push: {
    isAvailable: () => true,
    /**
     * Every failure here used to resolve to a bare `null`, which the caller reported as "denied".
     * So on 2026-08-16, with notifications switched ON in iOS and previews enabled, the owner got
     * no notification and `cadence.device_tokens` stayed empty — with nothing anywhere saying
     * which of three quite different things had happened: iOS refused, APNs refused, or we simply
     * gave up waiting. An invisible failure is the one you cannot fix, and this is the second one
     * this week (the coach's health reads were the first).
     *
     * The outcome is unchanged — null still means "no token" — but each path now says so out loud,
     * where Safari's Web Inspector can see it on the device that failed.
     */
    register: async () => {
      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        console.warn('[push] iOS did not grant notifications:', perm.receive);
        return null;
      }
      return new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          console.warn(`[push] no APNs token after ${PUSH_REGISTER_TIMEOUT_MS}ms — neither event fired`);
          resolve(null);
        }, PUSH_REGISTER_TIMEOUT_MS);
        void PushNotifications.addListener('registration', (token) => {
          clearTimeout(timer);
          console.info('[push] APNs token received');
          resolve(token.value);
        });
        void PushNotifications.addListener('registrationError', (err) => {
          clearTimeout(timer);
          // The likeliest cause is an App ID without the Push Notifications capability: signing
          // succeeds against the local entitlement, and APNs refuses at runtime.
          console.error('[push] APNs registration refused:', JSON.stringify(err));
          resolve(null);
        });
        void PushNotifications.register();
      });
    },
  },
  /**
   * On-device plan reminders. No server, no APNs, no network — and exact, because iOS owns the
   * clock. `repeats: true` with a weekday/hour/minute trigger occupies ONE of the OS's 64
   * pending slots and fires every week indefinitely, which is what keeps a full plan far below
   * the ceiling instead of scheduling one notification per occurrence.
   */
  localNotifications: {
    isAvailable: () => true,
    requestPermission: async () => {
      // iOS has a single notification permission — granting it here also covers push, and vice
      // versa. Asking again when already granted is a no-op, not a second prompt.
      const res = await LocalNotifications.requestPermissions();
      return res.display === 'granted';
    },
    sync: async (specs: LocalNotificationSpec[]) => {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') return 0;

      // Cancel-then-schedule, rather than trusting stable ids to overwrite. Ids are a hash and
      // can collide, and a plan that DROPS an activity leaves an orphan that no id-based upsert
      // would ever touch — the user would keep being reminded of something no longer in the plan.
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({ notifications: pending.notifications.map((p) => ({ id: p.id })) });
      }
      if (specs.length === 0) return 0;

      // Try the portrait path first. It writes to the same UNUserNotificationCenter, so the
      // cancel-then-schedule above still governs both, and a plugin that is missing or has no
      // donation in effect falls through to exactly what shipped before the portrait existed.
      try {
        const { decorated } = await CoachIdentity.scheduleWithIdentity({ notifications: specs });
        if (decorated) return specs.length;
      } catch {
        /* plugin absent → the ordinary path below */
      }
      await LocalNotifications.schedule({ notifications: specs.map(toNotification) });
      return specs.length;
    },
    cancelAll: async () => {
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length === 0) return;
      await LocalNotifications.cancel({ notifications: pending.notifications.map((p) => ({ id: p.id })) });
    },
    pendingCount: async () => (await LocalNotifications.getPending()).notifications.length,
  },
  /**
   * The coach's face on a notification, plus the long-press actions.
   *
   * `registerCategories` is idempotent and cheap, so it runs on every sync rather than once at
   * launch: a category registered at launch is lost if the app is killed before a notification
   * fires, and a notification whose category is unknown quietly renders with no buttons at all.
   */
  coachIdentity: {
    isAvailable: () => true,
    donate: async ({ senderName, avatarBase64 }) => {
      try {
        return (await CoachIdentity.donate({ senderName, avatarBase64 })).donated;
      } catch {
        // Plugin absent, or iOS refused the donation. The notification still goes out with the
        // app icon, which is what shipped before the portrait existed.
        return false;
      }
    },
    registerCategories: async () => {
      try {
        await LocalNotifications.registerActionTypes({
          types: NUDGE_CATEGORIES.map((c) => ({
            id: c.id,
            actions: c.actions.map((a) => ({ id: a.id, title: a.title, foreground: a.foreground })),
          })),
        });
      } catch {
        /* no actions is a worse notification, never a broken one */
      }
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
