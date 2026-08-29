import Foundation

/**
 The interval maths, ported line-for-line from packages/cadence-shared/src/interval.ts —
 KEEP IN LOCKSTEP. Same constants, same clamping, same vocabulary: a ROUND is work+recover,
 a SET is rounds repeated, warm-up/cool-down/rest sit OUTSIDE the rounds so counts never
 multiply them. The TS side is the tested original (interval.test.ts); anything changed
 there changes here.
 */
enum IntervalPhaseKind { case work, recover, neutral }

struct IntervalPhase {
    let kind: IntervalPhaseKind
    let label: String
    let seconds: Int
    var round: Int? = nil
    var globalRound: Int? = nil
}

struct IntervalSet { var workSec: Int; var recoverSec: Int; var rounds: Int }

struct IntervalPlan {
    var warmupSec: Int
    var sets: [IntervalSet]
    var restBetweenSetsSec: Int
    var cooldownSec: Int
}

enum IntervalEngine {
    // Bounds — interval.ts, verbatim.
    static let minWorkSec = 5
    static let maxWorkSec = 600
    static let maxRecoverSec = 600
    static let minRounds = 1
    static let maxRounds = 20
    static let maxEdgeSec = 900
    static let maxSets = 4
    static let defaultRestBetweenSetsSec = 60
    static let maxIntervalSec = 3600
    static let defaultWorkSec = 40
    static let defaultRecoverSec = 20
    static let defaultRounds = 6

    static func clamp(_ raw: IntervalPlan) -> IntervalPlan {
        var sets = raw.sets.isEmpty
            ? [IntervalSet(workSec: defaultWorkSec, recoverSec: defaultRecoverSec, rounds: defaultRounds)]
            : Array(raw.sets.prefix(maxSets))
        sets = sets.map { s in
            IntervalSet(
                workSec: min(max(s.workSec, minWorkSec), maxWorkSec),
                recoverSec: min(max(s.recoverSec, 0), maxRecoverSec),
                rounds: min(max(s.rounds, minRounds), maxRounds)
            )
        }
        var plan = IntervalPlan(
            warmupSec: min(max(raw.warmupSec, 0), maxEdgeSec),
            sets: sets,
            restBetweenSetsSec: min(max(raw.restBetweenSetsSec, 0), maxEdgeSec),
            cooldownSec: min(max(raw.cooldownSec, 0), maxEdgeSec)
        )
        // Trim rounds to fit the cap, never refuse — interval.ts's trimToFit.
        while totalSeconds(plan) > maxIntervalSec {
            guard let worst = plan.sets.indices.max(by: { plan.sets[$0].rounds < plan.sets[$1].rounds }),
                  plan.sets[worst].rounds > minRounds else { break }
            plan.sets[worst].rounds -= 1
        }
        return plan
    }

    /** expandIntervalPhases: a zero-length warm-up/recover/rest/cool-down simply is not there. */
    static func expand(_ raw: IntervalPlan) -> [IntervalPhase] {
        let p = clamp(raw)
        var phases: [IntervalPhase] = []
        if p.warmupSec > 0 { phases.append(IntervalPhase(kind: .neutral, label: "Warm-up", seconds: p.warmupSec)) }
        var globalRound = 0
        for (i, set) in p.sets.enumerated() {
            if i > 0 && p.restBetweenSetsSec > 0 {
                phases.append(IntervalPhase(kind: .neutral, label: "Rest", seconds: p.restBetweenSetsSec))
            }
            for r in 1...set.rounds {
                globalRound += 1
                phases.append(IntervalPhase(kind: .work, label: "Push", seconds: set.workSec, round: r, globalRound: globalRound))
                if set.recoverSec > 0 {
                    phases.append(IntervalPhase(kind: .recover, label: "Breathe", seconds: set.recoverSec, round: r, globalRound: globalRound))
                }
            }
        }
        if p.cooldownSec > 0 { phases.append(IntervalPhase(kind: .neutral, label: "Cool-down", seconds: p.cooldownSec)) }
        return phases
    }

    static func totalRounds(_ plan: IntervalPlan) -> Int {
        clamp(plan).sets.reduce(0) { $0 + $1.rounds }
    }

    static func totalSeconds(_ plan: IntervalPlan) -> Int {
        let p0 = plan
        let body = p0.sets.reduce(0) { $0 + $1.rounds * ($1.workSec + $1.recoverSec) }
        let rests = max(0, p0.sets.count - 1) * p0.restBetweenSetsSec
        return p0.warmupSec + body + rests + p0.cooldownSec
    }

    struct Position {
        let index: Int
        let remaining: Int
        let progress: Double
        let done: Bool
    }

    /** positionAt: where the player is, as a pure function of elapsed seconds. */
    static func position(in phases: [IntervalPhase], elapsed: Double) -> Position {
        var acc = 0.0
        for (i, phase) in phases.enumerated() {
            let end = acc + Double(phase.seconds)
            if elapsed < end {
                let into = elapsed - acc
                return Position(
                    index: i,
                    remaining: max(0, Int((Double(phase.seconds) - into).rounded(.up))),
                    progress: Double(phase.seconds) > 0 ? into / Double(phase.seconds) : 1,
                    done: false
                )
            }
            acc = end
        }
        return Position(index: max(0, phases.count - 1), remaining: 0, progress: 1, done: true)
    }
}
