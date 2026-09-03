# The coach's portrait on a notification

Makes Cadence's notifications look like they came from the coach rather than from an app: the
portrait the user picked replaces the app icon, the app icon becomes a corner badge, and Cadence
appears under **Settings → Focus → People** so it can be allowed through Do Not Disturb the way a
person is.

Two targets do this, because iOS gives no single place to do it:

| | built by | decorated by |
|---|---|---|
| **Local** — the plan reminders | `CadenceCoachIdentityPlugin` (this folder) | at schedule time |
| **Push** — plan-ready, the nudge dispatcher | APNs | `CadenceNotificationService` at delivery |

`UNNotificationContent.updating(from:)` is the call that attaches the identity, and it can only be
made on content the app is about to post. For a local notification that content is ours, so the
plugin schedules as well as donates. For a push it is built by APNs and never passes through the
app at all — which is why a service extension is the only way to reach one, and why every
server-sent notification showed the plain app icon until that extension existed.

Both build their sender from `App/Shared/CoachPortraitIntent.swift`, which is compiled into both
targets. That file is not a tidiness measure: `conversationIdentifier` and `customIdentifier` are
what iOS files the relationship under, and two targets that disagreed would put Cadence in Focus
settings twice, with "allow through" working for only half her notifications.

## Two things that fail silently if you get them wrong

**The interaction is `.incoming`.** The direction is from the USER's point of view, not the app's.
The coach sends, the user receives. Donated as `.outgoing` the system reads it as a message the
user themselves sent, leaves no sender to attribute the notification to, and `updating(from:)`
hands back undecorated content. Nothing throws, nothing logs, every notification just quietly
shows the app icon — which is what shipped from #151 until this was fixed.

**A push needs `mutable-content: 1`.** It is what wakes the extension. Without it iOS delivers the
payload as sent and the extension never runs. `services/push-apns.ts` adds it, and the chosen
`face_id` alongside — an extension cannot read the app's storage without an App Group, and a
portrait that depended on the app having run recently would be missing for exactly the first push
a new user gets. The portraits are a folder reference to `apps/cadence-web/public/avatars`, so the
extension and the web app serve the same files and adding one is still a single drop.

Someone who has picked no portrait sends neither key: nothing for the extension to do, and no
process launch to work that out.

## Entitlements — both targets carry it

`com.apple.developer.usernotifications.communication` goes on the **app target AND the
extension target**, plus `NSUserActivityTypes` = `INSendMessageIntent` in the app's `Info.plist`
and `IntentsSupported` in the extension's.

The extension needs it in its own right: it is the process calling `updating(from:)` for a push.
Without it the call throws, the `try?` in `NotificationService.swift` swallows the throw, and the
notification is delivered with the plain app icon — no crash, no log, nothing to notice.

### The wrong turn this section used to document

This file previously claimed the entitlement "cannot go there", citing Xcode's capability table:

```
id: USERNOTIFICATIONS_COMMUNICATION
supportedProductTypes: ["com.apple.product-type.application",
                        "com.apple.product-type.watchkit2-extension"]
```

That table is real (`DVTPortalCachedPortalCapabilities.json` inside `DVTPortal.framework`), but it
governs only which targets **Xcode's Signing & Capabilities UI** offers the checkbox for. The
developer portal has no notion of a product type — an App ID is just a bundle id — so the
capability can be enabled there by hand, and `CODE_SIGN_ENTITLEMENTS` on the target then signs
against the profile that results. Verified, not reasoned:

```
Provisioning Profile: "iOS Team Provisioning Profile: builders.cadence.app.NotificationService"
** BUILD SUCCEEDED **

$ codesign -d --entitlements - CadenceNotificationService.appex
application-identifier: ZLU84LMGQ6.builders.cadence.app.NotificationService
com.apple.developer.usernotifications.communication: true
```

The inference from "Xcode won't offer it" to "it fails to sign" cost this feature weeks of plain
app icons. **A capability table is a statement about a UI, not about what can be signed** — settle
this class of question with a device build, which fails loudly, rather than with a doc.

### Portal step (required, not automatic)

`builders.cadence.app.NotificationService` must exist as an **explicit** App ID with the
Communication Notifications capability enabled. Automatic signing will happily create the App ID
on its own, but it creates it **without** the capability — so the profile it mints is missing the
entitlement and the extension silently falls back. The first device build after adding it needs
`-allowProvisioningUpdates`; note that `cap run ios` can exit 0 on a failed `xcodebuild`, so read
the log for `BUILD SUCCEEDED` rather than trusting the exit code.

## Verified, and not

Compiled and linked for the simulator: the extension target produces its binary with all fifteen
portraits bundled under `avatars/`, and `services/push-apns.ts` has tests for the payload shape.

Still needs a device or simulator run:

- [ ] Pick a face, reload the plan. `donate` resolves `{ donated: true }`.
- [ ] A scheduled reminder fires showing the portrait, app icon as a corner badge.
- [ ] A push (`POST /dev/push`) arrives showing the same portrait.
- [ ] Settings → Focus → People lists Cadence exactly once.
- [ ] Long-press a `morning_adjust` notification: "Lighten today", "Keep it as planned",
      "Talk it through". The `extra` payload carries the pre-composed lighter day.
- [ ] Clearing the chosen face gives a plain app-icon notification, not a broken one.
- [ ] Re-syncing several times does not duplicate notifications (cancel-then-schedule still holds
      across the two scheduling paths).

## Wiring, if the project file is ever rebuilt

Capacitor's SPM layout does not auto-discover loose Swift files, but Capacitor 6+ discovers
`CAPBridgedPlugin` conformers at runtime — so the plugin needs to be in **Build Phases → Compile
Sources** for the App target and nothing else: no registration file, no `.m` bridging header.
`registerPlugin('CadenceCoachIdentity')` resolves lazily, so a build without it compiled in throws
at call time rather than at import, which is why every call site catches.
