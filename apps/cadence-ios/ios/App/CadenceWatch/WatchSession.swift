import Foundation

/**
 The session shapes, decoded straight off the wire.

 **These are the payload, not a translation of it.** Every property name here matches a key
 `buildWatchWeek` emits (`packages/cadence-shared/src/watch-week.ts`), so the whole receive path
 is one `JSONDecoder` call with no mapping layer to drift — KEEP IN LOCKSTEP with that file the
 same way `IntervalEngine` is kept in lockstep with `interval.ts`.

 Nothing here judges anything. Which face opens a session, what it is called, whether it can be
 started at all — all decided in TypeScript and carried in these fields.
 */

/** What a wrist does with a session. Unknown values decode to `.strength`, which is the one face
 *  that degrades to a list of names without lying about what it has — a watch that meets a kind
 *  from a newer phone shows the session rather than dropping it. */
enum WatchSessionKind: String, Codable {
    case interval, strength, sit, tracked

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = WatchSessionKind(rawValue: raw) ?? .strength
    }
}

enum WatchStatus: String, Codable {
    case pending, done, skipped, missed, paused

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = WatchStatus(rawValue: raw) ?? .pending
    }
}

struct WatchExercise: Identifiable, Codable, Hashable {
    let name: String
    var sets: Int? = nil
    var reps: Int? = nil
    var load: String? = nil
    var durationSec: Int? = nil

    var id: String { "\(name)-\(sets ?? 0)-\(reps ?? 0)-\(durationSec ?? 0)" }

    /** The mono line: `3 × 8 · 24 kg`, or `1:30` for a timed hold. Built here rather than sent so
     *  the payload carries facts and the wrist owns its own typography. */
    var spec: String {
        var bits: [String] = []
        if let sets, let reps { bits.append("\(sets) × \(reps)") }
        else if let reps { bits.append("× \(reps)") }
        if let load { bits.append(load) }
        if let durationSec, sets == nil {
            bits.append(String(format: "%d:%02d", durationSec / 60, durationSec % 60))
        }
        return bits.joined(separator: " · ")
    }
}

struct WatchBlock: Identifiable, Codable, Hashable {
    let label: String
    let items: [WatchExercise]

    var id: String { label }
}

/** The coach's flat interval five. `IntervalEngine` re-derives the phases from these exactly as
 *  `expandIntervalPhases` does on the phone, so both sides walk the same clock. */
struct WatchIntervalFields: Codable, Hashable {
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

struct WatchSession: Identifiable, Codable, Hashable {
    let occurrenceId: String
    let title: String
    let kind: WatchSessionKind
    let minutes: Int
    var subtitle: String
    var status: WatchStatus = .pending
    /** Whether the prescription rode along. FALSE means this row must not offer to start — the
     *  phone deliberately did not send detail for a day this far out, and an empty player is
     *  exactly the dead end the wrist cannot afford. */
    var detailed: Bool = false
    /** The activity, inferred on the phone from the same table the composer uses. Drives the live
     *  session's `HKWorkoutConfiguration`, so a run is filed as a run whether or not a WorkoutKit
     *  spec composed for it. */
    var activity: String = "other"
    /** Where it happens — what decides whether a route is recorded at all. */
    var location: String = "unknown"
    var blocks: [WatchBlock] = []
    var interval: WatchIntervalFields? = nil
    /** `tracked` only — the composed WorkoutKit spec (see `WorkoutSpec.swift`). Present means
     *  Apple's Workout app can be offered as an ALTERNATIVE to running the session ourselves;
     *  absent simply means that alternative is not shown. Our own tracker needs none of it. */
    var workout: WorkoutPlanSpec? = nil

    /** The occurrence id IS the identity — stable across syncs, so a re-sync does not churn
     *  SwiftUI's list or lose a navigation destination mid-session. */
    var id: String { occurrenceId }

    var isDone: Bool { status == .done }
}

struct WatchDay: Identifiable, Codable, Hashable {
    let date: String
    let weekday: String
    let isToday: Bool
    let sessions: [WatchSession]

    var id: String { date }

    /** Sessions worth showing a wrist as work to do — a finished day still counts them, it just
     *  draws them differently. */
    var doneCount: Int { sessions.filter(\.isDone).count }
}

/** The whole payload. `version` is checked before anything is trusted (see `WatchStore`). */
struct WatchWeekPayload: Codable, Hashable {
    let version: Int
    let generatedAt: String
    let days: [WatchDay]

    static let currentVersion = 1
    static let empty = WatchWeekPayload(version: currentVersion, generatedAt: "", days: [])

    var today: WatchDay? { days.first(where: \.isToday) }
}

/**
 Sample data — the simulator's week, and nothing else.

 W1 shipped this as the app's only source. It is now strictly a fallback for a build running
 without a paired phone: `WatchStore` prefers a synced week, then a persisted one, and reaches
 this only when neither exists. Kept walkable so every face can be developed in the simulator.
 */
enum SampleWeek {
    static let payload = WatchWeekPayload(
        version: WatchWeekPayload.currentVersion,
        generatedAt: "",
        days: [
            WatchDay(
                date: "2026-09-07", weekday: "Monday", isToday: true,
                sessions: [
                    WatchSession(
                        occurrenceId: "11111111-2222-3333-4444-555555555555",
                        title: "Morning intervals", kind: .interval, minutes: 14,
                        subtitle: "14 min · 6 rounds", status: .pending, detailed: true,
                        interval: WatchIntervalFields(workSec: 40, recoverSec: 20, rounds: 6)
                    ),
                    WatchSession(
                        occurrenceId: "22222222-2222-3333-4444-555555555555",
                        title: "Long run", kind: .tracked, minutes: 30,
                        subtitle: "30 min", status: .pending, detailed: true,
                        activity: "running", location: "outdoor"
                    ),
                    WatchSession(
                        occurrenceId: "33333333-2222-3333-4444-555555555555",
                        title: "Strength — lower", kind: .strength, minutes: 26,
                        subtitle: "26 min · 5 things", status: .pending, detailed: true,
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
                    WatchSession(
                        occurrenceId: "44444444-2222-3333-4444-555555555555",
                        title: "Evening sit", kind: .sit, minutes: 10,
                        subtitle: "10 min", status: .pending, detailed: true,
                        blocks: [WatchBlock(label: "Practice", items: [
                            WatchExercise(name: "Sit", durationSec: 600),
                        ])]
                    ),
                ]
            ),
            WatchDay(date: "2026-09-08", weekday: "Tuesday", isToday: false, sessions: []),
        ]
    )
}
