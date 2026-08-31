import Foundation

/**
 A strength session, flattened into the sequence a wrist actually walks.

 The prescription is blocks of exercises with set counts; what someone DOES is one set after
 another. Flattening happens here, once, so the timer face holds no arithmetic and the set-log
 knows exactly which set it is amending.

 Circuit blocks rotate (A,B,A,B) and straight blocks do not (A,A,B,B) — the same `mode` the phone
 walkthrough honours. The coach chooses per block; absent means straight, so a session that
 predates the field is unchanged.

 Nothing here is a judgement about training: it is the order the user was already shown.
 */
struct StrengthStep: Identifiable, Hashable {
    let exercise: WatchExercise
    /** 1-based set number within this exercise. */
    let setNumber: Int
    let totalSets: Int
    let blockLabel: String

    var id: String { "\(blockLabel)-\(exercise.id)-\(setNumber)" }

    /** "Set 2 of 3", or just the name's spec for a single-set item. */
    var setLine: String {
        totalSets > 1 ? "Set \(setNumber) of \(totalSets)" : exercise.spec
    }

    /**
     Is this a timed HOLD rather than a set of reps?

     A hold is prescribed by duration and nothing else — a dead hang, a plank, a wall sit. The
     distinction matters because it decides which face opens: a hold runs itself hands-free
     (`HoldView`), where a set of reps waits for you to say it is done. An item with both a
     duration and reps is reps that happen to be paced, so it is not a hold.
     */
    var isTimedHold: Bool {
        exercise.durationSec != nil && exercise.reps == nil
    }
}

enum StrengthPlan {
    /**
     Every set in the order it will be done.

     An exercise with no `sets` counts as one — a timed hold or a single effort is still a step
     someone performs, and dropping it would silently shorten the session they were shown.
     */
    static func steps(for session: WatchSession) -> [StrengthStep] {
        session.blocks.flatMap { block -> [StrengthStep] in
            let items = block.items
            guard !items.isEmpty else { return [] }
            let maxSets = items.map { max(1, $0.sets ?? 1) }.max() ?? 1

            // Circuit: rotate through the items, round by round. The block's own `rounds` would
            // refine this; absent, the items' own set counts define how many times around.
            if block.label.lowercased().contains("circuit") {
                return (1...maxSets).flatMap { round in
                    items.compactMap { item -> StrengthStep? in
                        let total = max(1, item.sets ?? 1)
                        guard round <= total else { return nil }
                        return StrengthStep(exercise: item, setNumber: round,
                                            totalSets: total, blockLabel: block.label)
                    }
                }
            }

            // Straight: each exercise's sets consecutively.
            return items.flatMap { item -> [StrengthStep] in
                let total = max(1, item.sets ?? 1)
                return (1...total).map { n in
                    StrengthStep(exercise: item, setNumber: n, totalSets: total, blockLabel: block.label)
                }
            }
        }
    }
}

/**
 What actually happened, set by set.

 Reps are seeded from the prescription and amended by the crown when they differ ("I did 5, not
 6"). The planned number is kept alongside so the log can say what was asked as well as what was
 done — and so nothing on screen ever silently rewrites the prescription.
 */
struct StrengthRecord: Hashable {
    let stepId: String
    let name: String
    let plannedReps: Int?
    var actualReps: Int?
    var done: Bool

    var amended: Bool {
        guard let plannedReps, let actualReps else { return false }
        return plannedReps != actualReps
    }
}
