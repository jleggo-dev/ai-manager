import ActivityKit
import Foundation

/**
 What the lock screen knows about a running walkthrough timer.

 Compiled into BOTH targets — the app (`CadenceLiveActivityPlugin` starts and updates the
 activity) and the widget extension (`CadenceTimerWidget` draws it). ActivityKit matches the two
 sides by this type's name and shape, so a field added on one side and not the other is an
 activity that silently never renders. There is one definition, here, on purpose.

 The clock is INSTANTS, not counts. The webview cannot run in the background, so nothing here
 can be "updated every second": the lock screen draws `Text(timerInterval:)` off `startedAt`
 and `endsAt` and counts on its own. A pause is the one state that needs the app awake, which
 is fine — pausing is a tap on the screen.
 */
@available(iOS 16.1, *)
struct TimerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// The instant the current run began. Nil while paused.
        var startedAt: Date?
        /// Seconds already done before the current run — all of it, while paused.
        var baseSeconds: Int
        /// The instant the target is reached at the current run's pace. Nil while paused.
        var endsAt: Date?
        var paused: Bool

        /// The instant the whole effort started, as if it had never paused — the anchor the
        /// elapsed count-up and the progress bar both measure from.
        var elapsedFrom: Date? {
            guard let startedAt = startedAt else { return nil }
            return startedAt.addingTimeInterval(-Double(baseSeconds))
        }
    }

    /// The step's own words — "Weighted ruck/hike" — never a generic "Timer".
    var title: String
    var targetSeconds: Int
}
