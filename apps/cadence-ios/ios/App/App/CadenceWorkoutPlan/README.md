# CadenceWorkoutPlan — local Capacitor plugin

The WorkoutKit hand-off (A13 v1). The phone composes a prescribed session — goal, pace, interval
structure — and schedules it into Apple's own Workout app on the paired watch, where it appears
with our icon and name. Apple does all the live tracking (GPS, heart rate, battery); the finished
workout lands in HealthKit carrying the plan id we chose, and the ordinary read path brings it
back.

## Status

**COMPILED, NOT DEVICE-VERIFIED.** Unlike CadenceCoachIdentity (written blind), this plugin has
been built against the iOS 26.5 SDK with Xcode 26.6 — the API signatures are compiler-checked, and
two of them were corrected by the compiler (`WorkoutScheduler.isSupported` is synchronous;
`schedule` does not throw). What no build can verify is behaviour against a real paired watch; see
the checklist.

The JS side degrades at every step (web build, no plugin, no watch, iOS < 17, authorization
refused): `useWatchHandoff` collapses every failure to "render nothing", so a broken bridge costs
the affordance, never the session sheet.

## Division of labour

**Everything decidable is decided in TypeScript** (`packages/cadence-shared/src/workout-plan.ts`,
unit-tested): what maps to a pacer vs a single goal vs a custom workout, how EMOM emits steps,
where the rest between sets goes, what composes to nothing at all. This Swift decodes a finished
spec and calls the framework — no bounds, no mapping tables beyond name↔enum, no judgements.

`WorkoutPlan.init(_:id:)` is given the occurrence id. That makes re-scheduling idempotent under
replan and lets the read-back attribute a finished `HKWorkout` to its occurrence via
`HKWorkout.workoutPlan` — the contract A14 consumes.

## Methods

- `isSupported()` → `{ supported, state }` — one round-trip gating the affordance.
- `requestAuthorization()` → `{ state }`.
- `schedule({ items: [{ spec, dateISO, hour?, minute? }] })` → per-item verdicts.
- `listScheduled()` / `remove({ id, dateISO? })` / `markComplete({ id, dateISO? })` /
  `removeAll()` — the rest of `WorkoutScheduler`'s surface, matched by plan id.

## Provisioning

No entitlement, no usage string, no `App.entitlements` change. The deployment floor stays 15.0;
every WorkoutKit use sits behind `@available(iOS 17.0, *)` and answers honestly below it.

**Already wired into `project.pbxproj`** (file reference + Sources phase, ids `CAD0C0DE2FE00003/4…`)
— no manual Xcode drag needed, and `xcodebuild -scheme App` compiles it today.

## Device checklist (do this before trusting it)

- [ ] `isSupported` on a phone with a paired watch: `{ supported: true }`; without: `false`.
- [ ] First `requestAuthorization` shows Apple's sheet; the choice round-trips as `state`.
- [ ] "Send to your watch" on a distance session → the workout sits in the watch's Workout app on
      its day, named for the occurrence, under our icon.
- [ ] An interval session renders warm-up / work / recover / cool-down blocks correctly on the watch.
- [ ] Probe `CustomWorkout.supportsActivity/.supportsGoal/.supportsAlert` per activity and write
      down what comes back (A13: support is a runtime question, not a table).
- [ ] Re-sending the same occurrence replaces rather than duplicates (same plan id).
- [ ] "Take it off" removes it from the watch's list.
- [ ] Complete the workout on the watch → `HKWorkout.workoutPlan` returns our id (A14's join key).
- [ ] `maxAllowedScheduledWorkoutCount` — read the real value before any schedule-the-week feature.
