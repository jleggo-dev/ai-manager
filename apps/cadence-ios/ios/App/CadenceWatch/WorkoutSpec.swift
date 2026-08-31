import Foundation
import HealthKit
import WorkoutKit

/**
 The composed workout, decoded from the payload (W2 — the wrist-side hand-off).

 **Decode only; every judgement was made in TypeScript.** `composeWorkoutPlan`
 (`packages/cadence-shared/src/workout-plan.ts`, 32 tests) decides what maps to a pacer vs a goal
 vs a custom workout, how an EMOM emits steps, where the rest between sets goes, and what composes
 to nothing at all. This file turns a finished spec into WorkoutKit's types and does nothing else.

 It is the `Codable` twin of the decoder in `App/CadenceWorkoutPlan/CadenceWorkoutPlanPlugin.swift`
 — the phone's reads Capacitor's `JSObject`, this one reads JSON, and both consume the same spec.
 KEEP IN LOCKSTEP: a field added to `WorkoutPlanSpec` belongs in both or in neither.
 */

struct WorkoutGoalSpec: Codable, Hashable {
    let kind: String
    var km: Double? = nil
    var seconds: Double? = nil

    @available(watchOS 10.0, *)
    var goal: WorkoutGoal? {
        switch kind {
        case "distance":
            guard let km, km > 0 else { return nil }
            return .distance(km, .kilometers)
        case "time":
            guard let seconds, seconds > 0 else { return nil }
            return .time(seconds, .seconds)
        default:
            return nil
        }
    }
}

struct IntervalStepSpec: Codable, Hashable {
    let purpose: String
    let goal: WorkoutGoalSpec
}

struct IntervalBlockSpec: Codable, Hashable {
    let steps: [IntervalStepSpec]
    let iterations: Int
}

struct WorkoutBodySpec: Codable, Hashable {
    let type: String
    var goal: WorkoutGoalSpec? = nil
    var distanceKm: Double? = nil
    var durationSec: Double? = nil
    var warmup: WorkoutGoalSpec? = nil
    var blocks: [IntervalBlockSpec]? = nil
    var cooldown: WorkoutGoalSpec? = nil
}

struct WorkoutPlanSpec: Codable, Hashable {
    let id: String
    let displayName: String
    let activity: String
    let location: String
    let body: WorkoutBodySpec
}

@available(watchOS 10.0, *)
extension WorkoutPlanSpec {
    /**
     The WorkoutKit plan, or nil when the spec cannot make one.

     Nil is a real answer and the caller must render it as one: the hand-off face shows the run
     without offering to open it, rather than presenting a button that fails on tap.
     */
    var plan: WorkoutPlan? {
        guard let uuid = UUID(uuidString: id), let workout = workout else { return nil }
        // The id is the occurrence id — the join key `HKWorkout.workoutPlan` hands back, so a run
        // finished in Apple's app is matched to the occurrence it came from rather than guessed
        // at by timestamp. Same contract the phone's scheduler uses.
        return WorkoutPlan(workout, id: uuid)
    }

    private var workout: WorkoutPlan.Workout? {
        let activityType = Self.activityType(activity)
        let locationType = Self.locationType(location)

        switch body.type {
        case "pacer":
            guard let km = body.distanceKm, let sec = body.durationSec, km > 0, sec > 0 else { return nil }
            return .pacer(PacerWorkout(
                activity: activityType,
                location: locationType,
                distance: Measurement(value: km, unit: UnitLength.kilometers),
                time: Measurement(value: sec, unit: UnitDuration.seconds)
            ))
        case "goal":
            guard let goal = body.goal?.goal else { return nil }
            return .goal(SingleGoalWorkout(activity: activityType, location: locationType, goal: goal))
        case "custom":
            let blocks = (body.blocks ?? []).compactMap(Self.block)
            guard !blocks.isEmpty else { return nil }
            return .custom(CustomWorkout(
                activity: activityType,
                location: locationType,
                displayName: displayName,
                warmup: body.warmup?.goal.map { WorkoutStep(goal: $0) },
                blocks: blocks,
                cooldown: body.cooldown?.goal.map { WorkoutStep(goal: $0) }
            ))
        default:
            return nil
        }
    }

    private static func block(_ raw: IntervalBlockSpec) -> IntervalBlock? {
        guard raw.iterations > 0 else { return nil }
        let steps = raw.steps.compactMap { step -> IntervalStep? in
            guard let goal = step.goal.goal else { return nil }
            return IntervalStep(step.purpose == "recovery" ? .recovery : .work, goal: goal)
        }
        guard !steps.isEmpty else { return nil }
        return IntervalBlock(steps: steps, iterations: raw.iterations)
    }

    /** Name → HealthKit type, via the GENERATED map (`Shared/WorkoutActivityMap.swift`), which is
     *  compiled into this target and the App target from one TypeScript catalog. */
    static func activityType(_ name: String) -> HKWorkoutActivityType {
        HKWorkoutActivityType.fromCadenceName(name)
    }

    static func locationType(_ name: String) -> HKWorkoutSessionLocationType {
        HKWorkoutSessionLocationType.fromCadenceName(name)
    }
}
