import SwiftUI
import WidgetKit

/**
 The widget extension that DRAWS the walkthrough timer on the lock screen and in the Dynamic
 Island. It holds no logic and no clock: `CadenceLiveActivityPlugin` (in the app) starts and
 updates the activity, and every number on screen is a `Text(timerInterval:)` counting off the
 instants in `TimerActivityAttributes.ContentState` on its own.

 A WidgetBundle rather than a bare Widget so a home-screen widget can join later without a
 second extension.
 */
@main
struct CadenceTimerWidgetBundle: WidgetBundle {
    var body: some Widget {
        if #available(iOS 16.2, *) {
            CadenceTimerLiveActivity()
        }
    }
}
