# The coach's portrait on a notification — why it never showed, and the device check

Owner, 2026-09-07, iOS Capacitor build on a real iPhone: "I still don't see the coach's avatar on
the notifications." Audit of the whole pipeline (web → Swift plugin → `INSendMessageIntent` →
extension → APNs payload), ranked by how likely each cause is to be the one in front of the owner.

## Ranked causes

### 1. FIXED — the Swift plugin was never registered with the Capacitor bridge

Capacitor 6+ does not scan the runtime for plugin classes. `CapacitorBridge.registerPlugins()`
(capacitor-swift-pm 8.5.0, `CapacitorBridge.swift:303-332`) loads its built-ins plus the
`packageClassList` in the generated `capacitor.config.json`, and the CLI writes that list from the
npm packages in `CapApp-SPM/Package.swift` only (`@capacitor/cli/dist/util/iosplugin.js:21-53`).
`CadenceCoachIdentityPlugin` is compiled into the App target but nothing anywhere called
`registerPluginInstance` — the project had no `CAPBridgeViewController` subclass at all
(`SceneDelegate.swift:11` and `Main.storyboard:14` both used the bare class).

Consequence: every `CoachIdentity.donate` / `scheduleWithIdentity` call from JS rejected with
`"CadenceCoachIdentity" plugin is not implemented on ios`; `native.ts` caught it without logging;
scheduling fell through to the plain `@capacitor/local-notifications` path. The entitlement fix
(#312), the extension (#351/#374) and the `.incoming` fix all landed on code that was never
called. The same applied to `CadenceAuthSession`, `CadenceWorkoutPlan`, `CadenceWatchSync` and
`CadenceLiveActivity` — consistent with all four still marked NOT DEVICE-VERIFIED.

Fix: `apps/cadence-ios/ios/App/App/CadenceBridgeViewController.swift` overrides
`capacitorDidLoad` and registers all five in-target plugins; `SceneDelegate.swift`,
`Main.storyboard` and `project.pbxproj` now point at it. (`registerPluginType` would NOT have
worked — it returns early while `autoRegisterPlugins` is on.)

### 2. FIXED — the failure was silent

Both catches in `apps/cadence-web/src/lib/capability/native.ts` (`coachIdentity.donate`,
`localNotifications.sync`) now `console.warn` the reason, so Safari's Web Inspector shows why a
fallback happened. Pinned by `native-coach-identity.test.ts`.

### 3. NEEDS DEVICE CHECK — Communication Notifications capability on both App IDs

`App.entitlements` and `CadenceNotificationService.entitlements` carry
`com.apple.developer.usernotifications.communication`. The App IDs `builders.cadence.app` and
`builders.cadence.app.NotificationService` must have "Communication Notifications" enabled in the
developer portal or automatic signing fails (the way `aps-environment` did before its capability
was added). If signing passes, this is fine.

### 4. NEEDS DEVICE CHECK — a face is chosen on the account

`null` face → app icon, by design (`coach-identity.ts:59-61`, `push-apns.ts:114-115`). The
account being tested must have a portrait picked (GET `/me/coach-face` returns a non-null
`face_id`).

### 5. NEEDS DEVICE CHECK — the push path specifically

Verified by reading: `mutable-content: 1` and `face_id` are set whenever the user has a face
(`push-apns.ts:120-136`, `coachFaceId` reads `users.coach_face_id`); the extension is embedded
(`Embed Foundation Extensions`, pbxproj:162-172), depends on the App, has `avatars` in its
Resources phase, `CoachPortraitIntent.swift` in both Sources phases, bundle id
`builders.cadence.app.NotificationService`, deployment target 15.0 (= app), entitlements via
`CODE_SIGN_ENTITLEMENTS`, `NSExtensionPrincipalClass = $(PRODUCT_MODULE_NAME).NotificationService`
with `PRODUCT_NAME = $(TARGET_NAME)`. What only a device proves: the extension actually runs
(a `mutable-content` push arrives with the portrait), and `APNS_ENVIRONMENT` matches the build
(`development` for a cable install).

### Checked and correct — no action

- Intent (`Shared/CoachPortraitIntent.swift`): `INPerson` with `INImage`, `customIdentifier` and
  `conversationIdentifier` both `cadence.coach`, image also set via `setImage(_:forParameterNamed:)`,
  `INInteraction.direction = .incoming`, completion reports `error == nil`.
- Ordering (`local-notifications-sync.ts:67-70`): `registerCategories` → `donateCoachIdentity`
  (awaited) → `sync` → `scheduleWithIdentity`; the plugin stores `donatedIntent` only on success.
- `coachIdentity.isAvailable()` is unconditionally `true` on native — not a gate.
- Face art: `/avatars/<id>.jpg` (`coach-face.ts:68`) resolves on `capacitor://localhost` because
  Vite copies `public/` into `dist` and `cap sync` ships it; all 15 JPEGs exist at 24-30 KB
  (limit 512 KB); ids contain no `.` or `/`, so the extension's path guard passes.
- `NSUserActivityTypes` contains `INSendMessageIntent` in the app's Info.plist; the extension's
  Info.plist declares `IntentsSupported`.

## Device checklist

Build (nothing on this Windows machine can build iOS — this has not been compiled):

1. `cd apps/cadence-ios && npm run sync` (builds the web bundle in ios mode, `cap sync`,
   verifies the bundle).
2. Delete Cadence from the phone first — the donated-intent store and notification permission
   state start fresh.
3. Xcode: Product → Clean Build Folder, then build the `App` scheme to the phone. Watch the log
   for `BUILD SUCCEEDED`. If it fails on `CadenceBridgeViewController`, the likely cause is
   signing (cause 3) or a compile error in one of the five plugins that was never compiled with
   a caller before.
4. On first launch, in Safari's Web Inspector console, `Capacitor.Plugins.CadenceCoachIdentity`
   should be an object, not `undefined`. That single line proves cause 1 is fixed.

iOS Settings to confirm:

- Settings → Notifications → Cadence → Allow Notifications on.
- Settings → Focus → (any Focus) → People: Cadence should be offered as a person once a
  donation has happened (open the app with a committed plan first).
- Developer portal → Identifiers → both App IDs → Communication Notifications ticked.

Trigger a test:

- Local: open the app with a committed plan and a face chosen. Sync runs on every plan load and
  logs `[reminders]` / `[coach-identity]` lines on failure (none on success). The next scheduled
  nudge is the check; a session time a few minutes out is the fastest way to get one. The timer
  alarm is NOT a valid check — it uses the plain path on purpose.
- Push: `POST /dev/push-test` (dev mode only, `CADENCE_DEV_USER_ID` set, APNs configured) sends
  "Test push — the path works." to the account's devices with `mutable-content` and `face_id`.

What working looks like: the coach's portrait replaces the app icon on the banner and in the
Notification Center, and the Cadence icon shrinks to a small badge at the portrait's corner. A
long press still shows the category buttons. If the icon is still full size: capture the Web
Inspector console at launch and at the first plan load — the `[coach-identity]` line names the
reason.
