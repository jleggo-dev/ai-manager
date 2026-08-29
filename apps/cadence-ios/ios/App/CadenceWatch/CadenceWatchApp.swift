import SwiftUI

/**
 Cadence on the wrist (watch app v1.5) — the coach's plan, runnable from the wrist.

 Spec: docs/cadence/DESIGN-PROMPT-watch.md (settled 2026-08-29; the canvas "Cadence on the
 Wrist" is the picture of it). GPS-free by ruling: runs hand off to Apple's Workout app;
 what runs HERE is what a wrist is good at — intervals, strength timers, a sit — in our
 frame, with Apple's workout engine (sensors, calories, the save) underneath.

 No judgements live in the views: the interval maths is `IntervalEngine` (a line-for-line
 port of packages/cadence-shared/src/interval.ts) and the session shapes mirror the
 composer's. W1 runs on sample data; WatchConnectivity sync is the next slice.
 */
@main
struct CadenceWatchApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                TodayView()
            }
        }
    }
}
