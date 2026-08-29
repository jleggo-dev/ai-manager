import Foundation
import HealthKit

/**
 Apple's engine under our shell: HKWorkoutSession + HKLiveWorkoutBuilder run the sensors,
 workout-cadence heart rate, calorimetry, background runtime and the save — we draw the
 frame and count the phases. GPS-free by ruling: activity types here never record routes.

 The join key: the finished workout carries the occurrence id as HKMetadataKeyExternalUUID,
 the same contract the phone's WorkoutKit hand-off uses — so the read-back attributes it,
 whoever ran it. Our own bundle id rides automatically as the source, which is what the
 seam's `recordedByBundleId` dedup keys on.
 */
final class WorkoutController: NSObject, ObservableObject {
    @Published var heartRate: Int? = nil
    @Published var running = false

    private let store = HKHealthStore()
    private var session: HKWorkoutSession? = nil
    private var builder: HKLiveWorkoutBuilder? = nil
    private var occurrenceId: String? = nil

    func requestAuthorization() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let share: Set<HKSampleType> = [HKObjectType.workoutType()]
        let read: Set<HKObjectType> = [
            HKQuantityType(.heartRate),
            HKQuantityType(.activeEnergyBurned),
        ]
        store.requestAuthorization(toShare: share, read: read) { _, _ in }
    }

    func begin(occurrenceId: String) {
        guard !running, HKHealthStore.isHealthDataAvailable() else { return }
        self.occurrenceId = occurrenceId
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .highIntensityIntervalTraining
        configuration.locationType = .indoor
        do {
            let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
            builder.delegate = self
            self.session = session
            self.builder = builder
            let start = Date()
            session.startActivity(with: start)
            builder.beginCollection(withStart: start) { [weak self] _, _ in
                DispatchQueue.main.async { self?.running = true }
            }
        } catch {
            // No session is a degraded run, not a broken one: the timer and haptics still
            // work; only the HR series and the auto-save are lost. Report by absence.
        }
    }

    func end() {
        guard running, let session, let builder else { return }
        running = false
        session.end()
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
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf types: Set<HKSampleType>) {
        guard types.contains(HKQuantityType(.heartRate)) else { return }
        let unit = HKUnit.count().unitDivided(by: .minute())
        let bpm = workoutBuilder.statistics(for: HKQuantityType(.heartRate))?
            .mostRecentQuantity()?.doubleValue(for: unit)
        if let bpm {
            DispatchQueue.main.async { self.heartRate = Int(bpm.rounded()) }
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
