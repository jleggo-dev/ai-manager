# CadenceWatchSync — local Capacitor plugin

The week-to-wrist sync (watch app W2). The phone pushes the committed week, already projected for
the watch, into WatchConnectivity's application context; our watch app receives it, persists it,
and runs from it. Before this, every face on the watch drew `SampleWeek` — hardcoded stub data.

Distinct from [`CadenceWorkoutPlan`](../CadenceWorkoutPlan/README.md), which schedules ONE session
into **Apple's** Workout app. This carries the whole week to **our** app.

## Status

**COMPILED, NOT DEVICE-VERIFIED.** Built against the iOS 26.5 / watchOS 26.5 SDKs with Xcode 26.6
(`xcodebuild -scheme App` builds phone and watch and embeds the latter). The watch app has been
run in the watchOS 26.5 simulator and the Today face verified against the design canvas. What no
build or simulator can verify is a real phone↔watch transfer; see the checklist.

## Division of labour

**Everything decidable is decided in TypeScript** — `buildWatchWeek`
(`packages/cadence-shared/src/watch-week.ts`, 47 tests): which sessions reach the wrist, which of
the four faces opens each one, how deep the detail rides, what a row's subtitle says, and what
gets shed to fit the transport. This Swift activates a session, reports what it can see, and hands
a string across.

## Why these choices

- **`updateApplicationContext`, not `sendMessage` or `transferUserInfo`.** It is a single
  latest-state slot: it coalesces (only the newest week matters), it is delivered when the watch
  next comes up rather than needing it reachable now, and it never builds a backlog of stale weeks
  behind a watch that spent the week in a drawer. `sendMessage` needs a live counterpart;
  `transferUserInfo` would queue every week we ever sent.
- **The payload crosses as a JSON string, not a dictionary.** Application context accepts only
  property-list types. A JS object marshalled by Capacitor arrives carrying `NSNull`s and nested
  arrays that each have to be sanitised into that world — one missed `null` and the whole context
  throws, taking the week with it. One string is one property-list value that cannot be malformed.
- **A byte budget, not just count caps.** `WATCH_MAX_PAYLOAD_BYTES` (48KB) is enforced in the
  projection, which sheds detail from the far end rather than letting the transport refuse the
  whole payload. Count caps bound the shape; only bytes bound what WatchConnectivity accepts.
- **The watch persists the last good week.** `WatchStore` writes to Application Support and paints
  from disk on launch. Application context arrives when the system chooses; without the disk copy
  the first paint of every launch is an empty week, which on a wrist reads as broken. The phone
  learned this at boot (PERF-09) — the paint has to outlive the process.

## The return leg

Sessions finished on the watch come back the other way, and the API choice is different on purpose:

- **`transferUserInfo`, not application context.** Context is a single latest-state slot that
  COALESCES — logging two sessions before the phone is reachable would silently discard the first.
  `transferUserInfo` queues each one and delivers in order, even if the phone is away for hours.
- **Two outboxes, because delivery is at-least-once.** The watch keeps a log on disk until
  WatchConnectivity accepts the transfer; the phone keeps it until the web layer confirms the API
  stored it. `didReceiveUserInfo` fires on the NATIVE app, which is routinely awake when the
  webview is not, so without the phone-side outbox a session would be announced to nobody.
- **Idempotent on the watch's own `finishedAt`.** A lost acknowledgement means the same finished
  session arrives twice; the server recognises it and does not count it again.
- **Structure, not prose.** The watch knows the numbers, so it sends them
  (`packages/cadence-shared/src/watch-log.ts`). The single free-text field is the dictated note,
  which goes to the coach's ordinary parse — and lands AFTER the structured write, so it reconciles
  against it using the revision path that already existed.

`WatchStore` on the watch holds the one `WCSession` delegate slot and drives both directions;
`WatchLogSender` deliberately does not set a delegate, because a second assignment would silently
replace the first and the watch would stop receiving plans.

## Methods

- `getState()` → `{ supported, paired, installed }` — one round-trip gate, answered only AFTER
  activation completes (`isPaired` is meaningless before that).
- `push({ payload })` → `{ delivered, reason? }` — hands the JSON across. A refusal comes back as
  a readable reason rather than a thrown error; `payloadTooLarge` here would mean the projection's
  byte budget is wrong.
- `pendingLogs()` → `{ logs: [{ id, payload }] }` — the phone's outbox of received session logs.
- `ackLogs({ ids })` — forget logs the API accepted. Anything unacknowledged is handed back.
- Event `logReceived` — fires when a log lands while the app is running, so the inbox drains
  without polling.

## Provisioning

No entitlement, no usage string, no `App.entitlements` change. WatchConnectivity is available from
iOS 9, so no `@available` guards and no deployment-floor change.

**Already wired into `project.pbxproj`** (file reference + Sources phase, ids
`CAD0C0DE2FE00005/6…`) — no manual Xcode drag needed.

## Device checklist (do this before trusting it)

- [ ] `getState` on a phone with a paired watch and our app installed: all three true. Unpair or
      delete the watch app → `installed: false`, and the JS layer stops pushing.
- [ ] Open the plan on the phone → the watch's Today face shows the REAL week within a few seconds.
- [ ] Force-quit the watch app and relaunch away from the phone → it paints the persisted week
      immediately, not an empty one.
- [ ] Finish a session on the phone → next plan load re-pushes and the watch row shows `done`.
- [ ] A day beyond tomorrow shows as a row with the phone glyph and cannot be started.
- [ ] Interval session on the wrist: wedge ring, haptic per handover, Done face shows rounds
      actually completed after ending early.
- [ ] Strength session: set dots advance, the crown amends reps, "Log 5" records 5.
- [ ] Run row → hand-off face → **Open Workout** puts Apple's Workout app on the composed run.
- [ ] A sit shows NO heart rate anywhere, and starts no workout session.
- [ ] Confirm the payload size in practice (`push` reason on failure) for a full week.
- [ ] **The return leg:** finish a strength session on the watch → the occurrence shows done on the
      phone with the sets that were logged, including an amended rep count.
- [ ] Finish a session with the phone OFF or out of range → it arrives when the phone is back.
- [ ] Dictate a note on Done → it reaches the log and reconciles against the structured record.
- [ ] Finish a sit → a mindful session appears in Health, and NO workout does.
- [ ] Kill the phone app mid-delivery → the log is redelivered and not double-counted.
