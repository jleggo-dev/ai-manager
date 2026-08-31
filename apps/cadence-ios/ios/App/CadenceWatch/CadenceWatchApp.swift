import SwiftUI

/**
 Cadence on the wrist — the coach's plan, runnable from the wrist.

 Spec: docs/cadence/DESIGN-PROMPT-watch.md (settled 2026-08-29; the canvas "Cadence on the
 Wrist" is the picture of it). What runs HERE is what a wrist is good at — intervals, strength
 timers, a sit — in our frame, with Apple's workout engine (sensors, calories, the save)
 underneath. Runs hand off to Apple's Workout app.

 No judgements live in the views. The interval maths is `IntervalEngine` (a line-for-line port of
 packages/cadence-shared/src/interval.ts); which face opens a session, what it is called and
 whether it can be started at all are decided by `buildWatchWeek` on the phone and arrive as
 fields. The views draw what they are given.

 W2 replaced the source, not the models: `WatchStore` holds the real committed week, synced from
 the phone over WatchConnectivity and persisted so a cold launch paints something true.
 */
@main
struct CadenceWatchApp: App {
    @StateObject private var store = WatchStore()
    /**
     ONE workout controller for the app.

     Only one `HKWorkoutSession` can be active at a time, and a session recovered after a kill has
     to arrive in the same object the faces are reading. Per-view controllers made both of those
     impossible and let two faces each start a session.
     */
    @StateObject private var workout = WorkoutController()

    init() {
        // Before any view builds a Font. A missing face degrades to the system one.
        WatchFonts.register()
    }

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TodayView()
            }
            .environmentObject(store)
            .environmentObject(workout)
            // Start listening as the UI comes up rather than in init: the first paint comes from
            // disk and must not wait on WatchConnectivity activating.
            .task {
                store.start()
                // A workout the system kept alive while this app was killed. Nothing happens in
                // the ordinary case; when there IS one, an hour-long run is not lost.
                workout.recoverIfInterrupted()
            }
        }
    }
}
