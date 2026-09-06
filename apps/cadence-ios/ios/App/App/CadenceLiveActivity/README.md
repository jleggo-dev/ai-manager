# CadenceLiveActivity — the timer on the lock screen

The walkthrough's timer as a Live Activity: a banner on the lock screen and a countdown in the
Dynamic Island, counting on its own while the phone is in a pocket and the webview is asleep.

Three pieces, because iOS puts them in three places:

| | where | does |
|---|---|---|
| `CadenceLiveActivityPlugin.swift` | app target (this folder) | `start` / `update` / `end` the activity from JS |
| `Shared/TimerActivityAttributes.swift` | app target AND widget target | the one shape both sides agree on |
| `CadenceTimerWidget/` | widget extension target | draws the banner and the island |

**Nothing counts time in Swift or in JS.** The app hands over instants — when the run began, how
much was done before it, when the target lands — and the lock screen draws `Text(timerInterval:)`
off them. That is what makes it work from a pocket: after `start` returns, the activity needs no
further word from the app until the person touches the timer again. The banner shows the
remaining time counting down (resting at 0:00 past the target) and the elapsed time counting up
(never stopping), so a ruck that runs long reads as exactly that.

The JS side is `lib/capability` (`liveActivity`) and `walkthrough/tools/timerLiveActivity.ts`:
start on run, update on pause and resume, end on stop / reset / finish / unmount. Web reports
unavailable and the timer behaves as it always did.

## Status

**WRITTEN BLIND — no Xcode on the machine that wrote it.** Every API used is documented
ActivityKit / WidgetKit 16.2 surface, but nothing here has been compiled. Expect the first build
to find a signature or two to correct (the WorkoutPlan plugin's README records the same and it
took two). The floor is iOS 16.2 behind `@available`; the project targets 15.0 and every method
answers honestly below it.

## Wiring — what is done and what needs Xcode

`project.pbxproj` **already carries** the widget target (`CadenceTimerWidget`, ids
`CAD0C0DE2FE3…`), mirroring `CadenceNotificationService` exactly: file references, a Sources
phase with the two widget files plus the shared attributes, the app-side Sources entries for the
plugin and the shared attributes, the target dependency, and the appex in "Embed Foundation
Extensions". `NSSupportsLiveActivities` is set in the app's `Info.plist`.

What Xcode has to do on first open, because a project file cannot:

1. **Signing.** Select the `CadenceTimerWidget` target → Signing & Capabilities → tick the team.
   Automatic signing mints the App ID `builders.cadence.app.TimerWidget`. No capability needed —
   Live Activities require no entitlement.
2. **Build once, read the log for `BUILD SUCCEEDED`** (`cap run ios` can exit 0 on a failed
   `xcodebuild`).
3. If the build complains the widget target has no `SwiftUI`/`WidgetKit` link: Build Phases → Link
   Binary With Libraries → add both. Swift usually links system frameworks on import; listed here
   only because it is the one thing hand-wiring cannot verify.

## Device checklist (do this before trusting it)

- [ ] Start a 50-min ruck timer, lock the phone: the banner shows the title, a countdown, and
      "m:ss of 50:00" counting up.
- [ ] Both numbers move with the phone locked and the app never reopened.
- [ ] Past the target the countdown rests at 0:00 and the elapsed line keeps climbing.
- [ ] Pause in the app: the banner shows the fixed elapsed time and "PAUSED"; resume: it counts again.
- [ ] Stop / Reset / finishing a hold / closing the walkthrough all take the banner down at once.
- [ ] Kill the app mid-timer, relaunch, start another timer: exactly one banner (the stale one is
      ended by `endAll`).
- [ ] Dynamic Island (iPhone 14 Pro and later): compact shows the countdown; expanded shows the
      title, countdown and elapsed line.
- [ ] Settings → Cadence → Live Activities off: `isAvailable` is false and the timer runs exactly
      as before, no banner, no error.
