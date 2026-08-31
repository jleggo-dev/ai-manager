import SwiftUI

/**
 Face 11 — Always-On.

 On Series 5 and later the screen never fully sleeps: when the wrist drops, watchOS keeps the app
 on screen at reduced luminance. A live session is exactly when that happens most — mid-run, mid-
 plank, mid-round — so this is not a polish state, it is the state the app is in for most of a
 workout.

 Three things follow, and the app got all three wrong before this file existed:

 - **Heart rate comes off.** The design brief specifies the dimmed face as "dim ring + numeral in
   the done stop, no HR". A number nobody is looking at, updating once a minute, is worse than
   absent: it reads as current and is not.
 - **Seconds come off.** `PeriodicTimelineSchedule` throttles to roughly once a minute in the
   low-frequency mode watchOS uses here, so a seconds digit would sit frozen and WRONG for up to
   59 seconds. Showing whole minutes is the honest resolution — stale by less than the rounding.
 - **Everything dims to the done stops.** Full-brightness amber on an always-on screen is both a
   battery cost and a lie about how live the number is.

 `isLuminanceReduced` is the SwiftUI environment value watchOS sets; reading it is the whole
 mechanism.
 */
extension View {
    /** Dim a live face for Always-On, at the opacity the brief's done stops imply. */
    func dimmedWhenAlwaysOn(_ reduced: Bool) -> some View {
        opacity(reduced ? 0.55 : 1)
    }
}

/**
 A clock rendered at the resolution the display can actually keep current.

 Live: `m:ss`, or `h:mm:ss` past an hour. Always-On: whole minutes, because the seconds would be
 stale. The unit is spelled out in the reduced state so nobody reads "12" as twelve seconds.
 */
func sessionClock(_ seconds: Int, alwaysOn: Bool) -> String {
    if alwaysOn {
        let minutes = seconds / 60
        return minutes == 1 ? "1 min" : "\(minutes) min"
    }
    if seconds >= 3600 {
        return String(format: "%d:%02d:%02d", seconds / 3600, (seconds % 3600) / 60, seconds % 60)
    }
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
}
