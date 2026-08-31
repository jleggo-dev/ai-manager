import Foundation
import HealthKit
import WatchKit

/**
 Apple's engine under our shell: HKWorkoutSession + HKLiveWorkoutBuilder run the sensors,
 workout-cadence heart rate, calorimetry, background runtime and the save — we draw the frame and
 count the phases. Outdoor sessions additionally record a route (`RouteRecorder`).

 The join key: the workout carries the occurrence id as HKMetadataKeyExternalUUID, the same
 contract the phone's WorkoutKit hand-off uses — so the read-back attributes it, whoever ran it.
 Our own bundle id rides automatically as the source, which is what the seam's
 `recordedByBundleId` dedup keys on.

 **There is exactly one of these, owned by the app and shared through the environment.** Only one
 workout session can be active at a time, and a recovered session has to arrive in the same object
 the faces are reading — a per-view controller made both of those impossible.
 */
@MainActor
final class WorkoutController: NSObject, ObservableObject {
    @Published var heartRate: Int? = nil
    @Published var running = false
    /** Mean of the samples this session collected, for the Done face's three facts. Nil until the
     *  builder has produced at least one — reported by absence rather than as a zero. */
    @Published var averageHeartRate: Int? = nil
    /** Kilometres, as HealthKit measured them. Nil for a session that covers no ground — an
     *  absent distance and a zero distance are different facts. */
    @Published var distanceKm: Double? = nil
    /** Active energy in kilocalories, as HealthKit measured it. */
    @Published var energyKcal: Int? = nil

    private let store = HKHealthStore()
    private var session: HKWorkoutSession? = nil
    private var builder: HKLiveWorkoutBuilder? = nil
    private var occurrenceId: String? = nil
    /** Set for a tracked session that is recording its route; nil for guided work. */
    private var route: RouteRecorder? = nil
    /** When the ACTIVE session began — the truth for a recovered one, whose elapsed time cannot
     *  come from a view that was destroyed with the process. */
    @Published private(set) var startedAt: Date? = nil
    /** The occurrence a recovered session belongs to, so the app can reopen the right face. */
    @Published private(set) var recoveredOccurrenceId: String? = nil

    func requestAuthorization() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let share: Set<HKSampleType> = [HKObjectType.workoutType(), HKSeriesType.workoutRoute()]
        let read: Set<HKObjectType> = [
            HKQuantityType(.heartRate),
            HKQuantityType(.activeEnergyBurned),
            HKQuantityType(.distanceWalkingRunning),
            HKQuantityType(.distanceCycling),
            HKQuantityType(.distanceSwimming),
        ]
        store.requestAuthorization(toShare: share, read: read) { _, _ in }
    }

    /**
     Start Apple's engine under our shell.

     `activity` is the caller's because the face knows what it is running and HealthKit files the
     workout under it — an interval player and a strength timer are genuinely different activity
     types, and passing the wrong one mislabels the workout in Health forever. GPS-free by ruling
     still holds HERE: the location type stays indoor, so no route is ever recorded by this app.
     */
    func begin(
        occurrenceId: String,
        activity: HKWorkoutActivityType = .highIntensityIntervalTraining,
        location: HKWorkoutSessionLocationType = .indoor,
        recordRoute: Bool = false
    ) {
        guard !running, HKHealthStore.isHealthDataAvailable() else { return }
        self.occurrenceId = occurrenceId
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activity
        // Outdoor is what makes Apple run GPS for distance and pace inside the session — the
        // difference between a tracked run and a treadmill one, and it costs us no code.
        configuration.locationType = location
        do {
            let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
            builder.delegate = self
            self.session = session
            self.builder = builder
            let start = Date()
            session.startActivity(with: start)
            /**
             The occurrence id goes on at START, not only at the end.

             A session recovered after the app is killed has nothing but its builder's metadata to
             say which occurrence it belonged to — stamping it only on the way out meant a
             recovered run could be saved to Health but never matched back to the plan. It is
             re-stamped at the end anyway, which is harmless: metadata merges.
             */
            builder.addMetadata([HKMetadataKeyExternalUUID: occurrenceId]) { _, _ in }
            builder.beginCollection(withStart: start) { [weak self] _, _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.running = true
                    self.startedAt = start
                    // Water lock, for a swim. The header is explicit that only a foreground app in
                    // an ACTIVE workout may enable it, which is why this sits here rather than at
                    // the tap: without it, water taps the screen continuously through a swim.
                    if activity == .swimming {
                        WKInterfaceDevice.current().enableWaterLock()
                    }
                    // The route is strictly additive: started only when asked, and its absence
                    // costs a map rather than the session.
                    if recordRoute {
                        let recorder = RouteRecorder()
                        self.route = recorder
                        recorder.start(with: builder)
                    }
                }
            }
        } catch {
            // No session is a degraded run, not a broken one: the timer and haptics still
            // work; only the HR series and the auto-save are lost. Report by absence.
        }
    }

    /**
     Re-attach a workout the system kept alive after this app was killed.

     **This is the difference between losing an hour-long run and not.** watchOS jettisons apps
     under memory pressure, and the likeliest moment is exactly the one we now support: a long
     outdoor session with the screen off. HealthKit keeps the session alive across that —
     `recoverActiveWorkoutSessionWithCompletion:` exists for precisely this — but a session nobody
     re-attaches is never ended, never saved, and never reaches the plan.

     Called once at launch. When nothing is recovered (the ordinary case) it does nothing at all.

     The occurrence id comes off the builder's own metadata, which is why `begin` stamps it at the
     START. Without that, a recovered session could be saved to Health but never matched back.
     */
    func recoverIfInterrupted() {
        guard HKHealthStore.isHealthDataAvailable(), !running else { return }
        store.recoverActiveWorkoutSession { [weak self] session, _ in
            guard let session else { return } // nothing to recover — the ordinary case
            Task { @MainActor in
                guard let self, !self.running else { return }
                let builder = session.associatedWorkoutBuilder()
                builder.delegate = self
                // The data source is NOT restored with the session; without re-attaching one the
                // session runs on but collects nothing, which looks like a working recovery and
                // silently records an empty workout.
                builder.dataSource = HKLiveWorkoutDataSource(
                    healthStore: self.store,
                    workoutConfiguration: session.workoutConfiguration
                )
                self.session = session
                self.builder = builder
                self.running = true
                self.startedAt = session.startDate
                let recovered = builder.metadata[HKMetadataKeyExternalUUID] as? String
                self.occurrenceId = recovered
                self.recoveredOccurrenceId = recovered
                // The route is deliberately NOT resumed. Its own builder went with the process,
                // and the fixes from before the kill are already in the series the workout will
                // attach on save; restarting location now would append a straight line across
                // whatever happened while the app was gone.
            }
        }
    }

    /** The app has reopened the recovered session, so it no longer needs announcing. */
    func clearRecoveryFlag() {
        recoveredOccurrenceId = nil
    }

    func end() {
        guard running, let session, let builder else { return }
        running = false
        // Stop feeding the route BEFORE finishing the workout — the workout builder is what
        // attaches the finished series, so the route must be complete by then.
        route?.stop()
        route = nil
        session.end()
        startedAt = nil
        recoveredOccurrenceId = nil
        let finish = Date()
        let metadata: [String: Any] = occurrenceId.map { [HKMetadataKeyExternalUUID: $0] } ?? [:]
        builder.addMetadata(metadata) { _, _ in
            builder.endCollection(withEnd: finish) { _, _ in
                builder.finishWorkout { _, _ in }
            }
        }
    }
}

extension WorkoutController: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        guard types.contains(HKQuantityType(.heartRate)) else { return }
        let unit = HKUnit.count().unitDivided(by: .minute())
        let statistics = workoutBuilder.statistics(for: HKQuantityType(.heartRate))
        let bpm = statistics?.mostRecentQuantity()?.doubleValue(for: unit)
        Self.readTotals(from: workoutBuilder) { [weak self] km, kcal in
            Task { @MainActor in
                if let km { self?.distanceKm = km }
                if let kcal { self?.energyKcal = kcal }
            }
        }
        // The average comes from the builder's own statistics rather than a running total of our
        // own: HealthKit already computes it over exactly the samples it collected, and a second
        // arithmetic would be a second answer to the same question.
        let average = statistics?.averageQuantity()?.doubleValue(for: unit)
        Task { @MainActor in
            if let bpm { self.heartRate = Int(bpm.rounded()) }
            if let average { self.averageHeartRate = Int(average.rounded()) }
        }
    }

    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    /**
     Distance and energy, from whichever distance type this activity collects.

     `HKLiveWorkoutDataSource` populates the collected types from the workout CONFIGURATION, so a
     run reports `distanceWalkingRunning`, a ride `distanceCycling` and a swim `distanceSwimming`.
     Asking for all three and taking the one that answers avoids a per-activity table that would
     be a fourth copy of a mapping we already generate.
     */
    private nonisolated static func readTotals(
        from builder: HKLiveWorkoutBuilder,
        _ done: @escaping (Double?, Int?) -> Void
    ) {
        let distanceTypes: [HKQuantityTypeIdentifier] = [
            .distanceWalkingRunning, .distanceCycling, .distanceSwimming,
        ]
        var km: Double? = nil
        for identifier in distanceTypes {
            if let metres = builder.statistics(for: HKQuantityType(identifier))?
                .sumQuantity()?.doubleValue(for: .meter()), metres > 0 {
                km = metres / 1000
                break
            }
        }
        let kcal = builder.statistics(for: HKQuantityType(.activeEnergyBurned))?
            .sumQuantity()?.doubleValue(for: .kilocalorie())
        done(km, kcal.map { Int($0.rounded()) })
    }
}
