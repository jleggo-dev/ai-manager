import Foundation

/**
 The session shapes, mirroring the composer's structured data (SessionItem's quantity fields
 and the flat interval_* five). W1 ships SAMPLE data so every face is walkable in the
 simulator; the WatchConnectivity sync (phone pushes the committed week as JSON) is the next
 slice, and these Codable keys are already named for it.
 */
struct WatchExercise: Identifiable, Codable {
    var id = UUID()
    let name: String
    var sets: Int? = nil
    var reps: Int? = nil
    var load: String? = nil
    var durationSec: Int? = nil

    var spec: String {
        var bits: [String] = []
        if let sets, let reps { bits.append("\(sets) × \(reps)") }
        if let load { bits.append(load) }
        if let durationSec, sets == nil {
            bits.append(String(format: "%d:%02d", durationSec / 60, durationSec % 60))
        }
        return bits.joined(separator: " · ")
    }
}

struct WatchBlock: Identifiable, Codable {
    var id = UUID()
    let label: String
    let items: [WatchExercise]
}

enum WatchSessionKind: String, Codable { case interval, strength, sit, run }

struct WatchSession: Identifiable, Codable {
    var id = UUID()
    let occurrenceId: String
    let title: String
    let kind: WatchSessionKind
    let minutes: Int
    var subtitle: String
    var blocks: [WatchBlock] = []
    var interval: WatchIntervalFields? = nil
}

/** The coach's five flat fields, exactly as the composer carries them. */
struct WatchIntervalFields: Codable {
    var warmupSec: Int = 0
    var workSec: Int
    var recoverSec: Int
    var rounds: Int
    var cooldownSec: Int = 0

    var plan: IntervalPlan {
        IntervalPlan(
            warmupSec: warmupSec,
            sets: [IntervalSet(workSec: workSec, recoverSec: recoverSec, rounds: rounds)],
            restBetweenSetsSec: IntervalEngine.defaultRestBetweenSetsSec,
            cooldownSec: cooldownSec
        )
    }
}

enum SampleWeek {
    static let today: [WatchSession] = [
        WatchSession(
            occurrenceId: "11111111-2222-3333-4444-555555555555",
            title: "Morning intervals", kind: .interval, minutes: 14, subtitle: "14 min · 6 rounds",
            interval: WatchIntervalFields(workSec: 40, recoverSec: 20, rounds: 6)
        ),
        WatchSession(
            occurrenceId: "22222222-2222-3333-4444-555555555555",
            title: "Long run", kind: .run, minutes: 30, subtitle: "5 km · opens Workout"
        ),
        WatchSession(
            occurrenceId: "33333333-2222-3333-4444-555555555555",
            title: "Strength — lower", kind: .strength, minutes: 26, subtitle: "26 min · 5 things",
            blocks: [
                WatchBlock(label: "Warm-up", items: [
                    WatchExercise(name: "Leg swings", durationSec: 45),
                    WatchExercise(name: "Air squats", sets: 1, reps: 10),
                ]),
                WatchBlock(label: "Main", items: [
                    WatchExercise(name: "Goblet squats", sets: 3, reps: 8, load: "24 kg"),
                    WatchExercise(name: "Split squats", sets: 3, reps: 10),
                    WatchExercise(name: "Romanian deadlifts", sets: 3, reps: 8, load: "40 kg"),
                ]),
            ]
        ),
    ]
}
