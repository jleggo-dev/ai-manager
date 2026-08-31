import Foundation

/**
 The Swift half of the interval engine parity check.

 `IntervalEngine.swift` is a hand port of `packages/cadence-shared/src/interval.ts` and is marked
 KEEP IN LOCKSTEP. This is what makes that enforceable: both sides are pinned to one artifact,
 `packages/cadence-shared/interval-parity.json`. TypeScript asserts it still produces that file;
 this asserts Swift produces the same one.

 Deliberately a plain executable rather than an XCTest bundle. `IntervalEngine.swift` imports only
 Foundation, so it compiles and runs on macOS directly — no test target, no simulator, no host app,
 and CI runs it with one command. Run it with `npm run check:interval-parity`.

 A failure means the phone and the watch would count a session differently — which decides how many
 rounds a log records, so it is a correctness bug, not a style one.
 */

struct ParityPhase: Codable, Equatable {
    let kind: String
    let label: String
    let seconds: Int
    let round: Int?
    let globalRound: Int?
}

struct ParitySet: Codable { let workSec: Int; let recoverSec: Int; let rounds: Int }

struct ParityPlan: Codable {
    let warmupSec: Int
    let sets: [ParitySet]
    let restBetweenSetsSec: Int
    let cooldownSec: Int

    var engine: IntervalPlan {
        IntervalPlan(
            warmupSec: warmupSec,
            sets: sets.map { IntervalSet(workSec: $0.workSec, recoverSec: $0.recoverSec, rounds: $0.rounds) },
            restBetweenSetsSec: restBetweenSetsSec,
            cooldownSec: cooldownSec
        )
    }
}

struct ParityRoundsAt: Codable { let elapsed: Int; let rounds: Int }

struct ParityCase: Codable {
    let name: String
    let plan: ParityPlan
    let totalSeconds: Int
    let totalRounds: Int
    let phases: [ParityPhase]
    let roundsAt: [ParityRoundsAt]
}

struct ParityFixture: Codable { let cases: [ParityCase] }

func kindName(_ kind: IntervalPhaseKind) -> String {
    switch kind {
    case .work: return "work"
    case .recover: return "recover"
    case .neutral: return "neutral"
    }
}

@main
struct IntervalParityCheck {
    static func main() {
        let path = CommandLine.arguments.count > 1
            ? CommandLine.arguments[1]
            : "packages/cadence-shared/interval-parity.json"

        guard let data = FileManager.default.contents(atPath: path) else {
            FileHandle.standardError.write("parity: cannot read fixture at \(path)\n".data(using: .utf8)!)
            exit(2)
        }
        guard let fixture = try? JSONDecoder().decode(ParityFixture.self, from: data) else {
            FileHandle.standardError.write("parity: fixture at \(path) is not the expected shape\n".data(using: .utf8)!)
            exit(2)
        }

        var failures: [String] = []

        for testCase in fixture.cases {
            let plan = testCase.plan.engine
            let phases = IntervalEngine.expand(plan)

            let actualTotal = IntervalEngine.totalSeconds(IntervalEngine.clamp(plan))
            if actualTotal != testCase.totalSeconds {
                failures.append("\(testCase.name): totalSeconds \(actualTotal) != \(testCase.totalSeconds)")
            }

            let actualRounds = IntervalEngine.totalRounds(plan)
            if actualRounds != testCase.totalRounds {
                failures.append("\(testCase.name): totalRounds \(actualRounds) != \(testCase.totalRounds)")
            }

            let actualPhases = phases.map {
                ParityPhase(kind: kindName($0.kind), label: $0.label, seconds: $0.seconds,
                            round: $0.round, globalRound: $0.globalRound)
            }
            if actualPhases.count != testCase.phases.count {
                failures.append("\(testCase.name): \(actualPhases.count) phases, expected \(testCase.phases.count)")
            } else {
                for (i, expected) in testCase.phases.enumerated() where actualPhases[i] != expected {
                    failures.append("\(testCase.name): phase \(i) \(actualPhases[i]) != \(expected)")
                }
            }

            for mark in testCase.roundsAt {
                let actual = IntervalEngine.roundsCompleted(phases, elapsed: Double(mark.elapsed))
                if actual != mark.rounds {
                    failures.append("\(testCase.name): roundsCompleted@\(mark.elapsed) \(actual) != \(mark.rounds)")
                }
            }
        }

        if failures.isEmpty {
            print("interval parity: \(fixture.cases.count) cases match interval.ts")
            exit(0)
        }
        FileHandle.standardError.write("interval parity FAILED — the Swift port has drifted from interval.ts:\n".data(using: .utf8)!)
        for failure in failures { FileHandle.standardError.write("  \(failure)\n".data(using: .utf8)!) }
        exit(1)
    }
}
