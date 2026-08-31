import Foundation
import CoreLocation
import HealthKit

/**
 The route line for a tracked session — the one piece of GPS work that is genuinely ours.

 **What Apple already does, and what it does not.** `HKLiveWorkoutDataSource` collects the default
 quantity types for a workout configuration automatically, so distance, pace, heart rate and
 energy arrive with no CoreLocation code from us at all — Apple runs the GPS duty cycle inside the
 workout session and owns the power behaviour. `HKWorkoutRouteBuilder` is the exception: it does
 NOT collect locations. The caller feeds it `CLLocation`s, which is why this file exists and why
 nothing else in the app touches CoreLocation.

 So the route is strictly additive. If authorization is refused, or a fix never arrives, the
 session still records distance, pace, heart rate and energy and still saves to Health — the user
 loses a map and nothing else. That is the failure posture every method here keeps.

 **On the ruling.** The watch app was scoped GPS-free in the 2026-08-29 revisit; that scoping was
 the assistant's own caution rather than an owner preference, and the owner lifted it on
 2026-08-30 ("I am fine with it tracking where you go"). The user-facing promise that conflicted
 with it — "It never tracks where you go" — was corrected in the same pass.
 */
@MainActor
final class RouteRecorder: NSObject, ObservableObject {
    /** Whether a route is actually being recorded. The face shows a map glyph only when true, so
     *  nobody is told their run is being traced when it is not. */
    @Published private(set) var recording = false

    private let manager = CLLocationManager()
    private var builder: HKWorkoutRouteBuilder?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        // The workout session's own updates are what keep this alive in the background; the
        // activity type lets CoreLocation tune its filtering to a person moving under their own
        // power rather than a car.
        manager.activityType = .fitness
        manager.allowsBackgroundLocationUpdates = true
    }

    /**
     Start recording, using the workout builder's OWN series builder.

     `HKWorkoutRouteBuilder`'s header is explicit: when there is already an `HKWorkoutBuilder`, ask
     it for the series builder rather than constructing one — that is what associates the finished
     route with the finished workout. Constructing our own would save a route attached to nothing.
     */
    func start(with workoutBuilder: HKLiveWorkoutBuilder) {
        guard !recording else { return }
        builder = workoutBuilder.seriesBuilder(for: HKSeriesType.workoutRoute()) as? HKWorkoutRouteBuilder
        guard builder != nil else { return } // no series builder, no route — the session is fine
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
        recording = true
    }

    /**
     Stop feeding the route. Deliberately does NOT finish it.

     `HKWorkoutRouteBuilder`'s header is explicit: "If you are using this route builder with a
     workout builder, you should never call [finishRoute]. The route will be finished when you
     finish the workout builder." Calling it here would try to attach the route to a workout of
     our own invention — read from the SDK rather than assumed, after a first pass got it wrong.
     */
    func stop() {
        guard recording else { return }
        recording = false
        manager.stopUpdatingLocation()
        builder = nil
    }

    /** Abandon a session being thrown away. Discarding the WORKOUT builder discards its series
     *  too, so this only has to stop the flow of fixes. */
    func discard() {
        stop()
    }
}

extension RouteRecorder: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        /**
         Filter before storing.

         The first fixes after a cold start are routinely tens of metres out, and a bad fix does
         not just draw a wrong line — it inflates distance permanently. Apple's own guidance is to
         drop fixes with poor or negative accuracy and stale timestamps, so a run recorded under
         trees does not report a kilometre nobody covered.
         */
        let usable = locations.filter { location in
            location.horizontalAccuracy > 0
                && location.horizontalAccuracy <= 50
                && abs(location.timestamp.timeIntervalSinceNow) < 10
        }
        guard !usable.isEmpty else { return }
        Task { @MainActor in
            guard self.recording, let builder = self.builder else { return }
            try? await builder.insertRouteData(usable)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Reported by absence: the map is lost, the session is not. Stopping updates here would
        // give up on a fix that often returns a few seconds later.
    }
}
