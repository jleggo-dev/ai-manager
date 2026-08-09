# CadenceCoachIdentity — local Capacitor plugin

Makes Cadence's notifications look like they came from the coach rather than from an app: the
portrait the user picked replaces the app icon, the app icon becomes a corner badge, and Cadence
appears under **Settings → Focus → People** so it can be allowed through Do Not Disturb the way a
person is.

## Status

**UNVERIFIED ON DEVICE.** This was written without an Xcode build available. Nothing here has been
compiled, let alone run. It needs a simulator build before it is trusted — see the checklist below.

The JS side degrades silently at every step (no chosen face, plugin missing, donation refused), and
the fallback is the ordinary `@capacitor/local-notifications` path that shipped before this
existed. So a plugin that does not work costs the portrait, not the notification.

## What it does

1. `donate({ senderName, avatarBase64 })` — builds an `INSendMessageIntent` with an `INImage` from
   the passed bytes and donates it as an outgoing `INInteraction`. This is what registers Cadence
   under "People".
2. `scheduleWithIdentity({ notifications })` — schedules local notifications with
   `UNNotificationContent.updating(from:)` applied.

Step 2 is not optional gold-plating. `updating(from:)` is the call that actually attaches the
identity, and it can only be made on the content the app is about to post — which, for local
notifications, is built by whoever schedules them. A donate-only plugin would register Cadence in
Focus settings and change nothing about how a notification looks.

It writes to the same `UNUserNotificationCenter` as `@capacitor/local-notifications`, so ids,
cancellation and `getPending` continue to work through that plugin. Only the schedule step moves.

## Wiring it into the Xcode project

The Capacitor SPM layout does not auto-discover loose Swift files. After `npx cap sync ios`:

1. Open `App.xcworkspace`.
2. Drag `App/App/CadenceCoachIdentity/` into the **App** target (Create groups, not folder
   references; tick the App target under "Add to targets").
3. Confirm `CadenceCoachIdentityPlugin.swift` appears in **Build Phases → Compile Sources**.

Nothing else is needed: Capacitor 6+ discovers `CAPBridgedPlugin` conformers at runtime, so there
is no registration file and no `.m` bridging header.

`registerPlugin('CadenceCoachIdentity')` on the JS side resolves lazily, so a build without this
compiled in throws at call time rather than at import — which is why every call site catches.

## Simulator checklist (do this before trusting it)

- [ ] It compiles, and the target builds.
- [ ] Pick a coach face in Settings, then reload the plan. `donate` resolves `{ donated: true }`.
- [ ] A scheduled notification fires showing the portrait, with the app icon as a corner badge.
- [ ] Settings → Focus → People lists Cadence.
- [ ] Long-press a `morning_adjust` notification: "Lighten today", "Keep it as planned",
      "Talk it through". The `extra` payload carries the pre-composed lighter day.
- [ ] Clearing the chosen face and re-syncing gives a plain app-icon notification, not a broken one.
- [ ] Re-syncing several times does not duplicate notifications (cancel-then-schedule still holds
      across the two scheduling paths).
