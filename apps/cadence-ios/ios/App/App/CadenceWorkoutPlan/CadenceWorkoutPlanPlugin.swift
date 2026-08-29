import Foundation
import Capacitor
import HealthKit
import WorkoutKit

/**
 Hands a composed session to Apple's Workout app on the watch (A13 v1).

 The phone COMPOSES the workout — goal, pace, interval structure — and Apple does all the live
 tracking: GPS, heart rate, battery behaviour, the whole running of it. The scheduled session
 appears in the watch's Workout app with our icon and name, the result lands in HealthKit, and we
 read it back through the query path we already have.

 **This plugin makes no judgements.** Every decidable thing — what maps to a pacer vs a goal vs a
 custom workout, how an EMOM emits steps, where the rest between sets goes — is decided in
 TypeScript (`packages/cadence-shared/src/workout-plan.ts`), unit-tested there, and arrives here as
 a finished spec. The Swift below decodes and calls the framework, nothing else. When WorkoutKit
 refuses something (no watch paired, an activity that does not support a goal shape), the refusal
 is reported per item as a fact; it is never predicted here with a hardcoded support matrix.

 WorkoutKit needs no entitlement and no usage string. The one real constraint is the floor: the
 framework is iOS 17 and the project targets 15, so every use sits behind `@available` and each
 method answers honestly on an older OS instead of crashing.
 */
@objc(CadenceWorkoutPlanPlugin)
public class CadenceWorkoutPlanPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CadenceWorkoutPlanPlugin"
    public let jsName = "CadenceWorkoutPlan"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listScheduled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "markComplete", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeAll", returnType: CAPPluginReturnPromise)
    ]

    // MARK: - Support & authorization

    /**
     One round-trip answering "may the affordance render at all": framework present, scheduling
     supported (a paired watch is what this really asks), and the current authorization state.
     A dead "send to your watch" button is exactly the class of defect the device rounds keep
     finding, so the UI gates on this and renders nothing when the answer is no.
     */
    @objc func isSupported(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.resolve(["supported": false, "state": "unavailable"])
            return
        }
        Task {
            guard WorkoutScheduler.isSupported else {
                call.resolve(["supported": false, "state": "unavailable"])
                return
            }
            let state = await WorkoutScheduler.shared.authorizationState
            call.resolve(["supported": true, "state": Self.stateName(state)])
        }
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.resolve(["state": "unavailable"])
            return
        }
        Task {
            let state = await WorkoutScheduler.shared.requestAuthorization()
            call.resolve(["state": Self.stateName(state)])
        }
    }

    @available(iOS 17.0, *)
    private static func stateName(_ state: WorkoutScheduler.AuthorizationState) -> String {
        switch state {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "notDetermined"
        }
    }

    // MARK: - Scheduling

    /**
     Schedule each item; per-item results, never all-or-nothing. The plan id is the occurrence id
     (chosen in TypeScript, deterministic), which is what makes re-scheduling after a replan
     replace rather than duplicate — and what lets the read-back attribute a finished workout to
     the occurrence it came from via `HKWorkout.workoutPlan`.
     */
    @objc func schedule(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.resolve(["scheduled": 0, "results": []])
            return
        }
        let items = call.getArray("items", JSObject.self) ?? []
        Task {
            var results: [[String: Any]] = []
            var scheduled = 0
            for item in items {
                let id = (item["spec"] as? JSObject)?["id"] as? String ?? ""
                do {
                    try await Self.scheduleOne(item)
                    scheduled += 1
                    results.append(["id": id, "scheduled": true])
                } catch {
                    // The refusal IS the answer (no watch, unsupported shape) — report, don't guess.
                    results.append(["id": id, "scheduled": false, "reason": error.localizedDescription])
                }
            }
            call.resolve(["scheduled": scheduled, "results": results])
        }
    }

    @objc func listScheduled(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.resolve(["items": []])
            return
        }
        Task {
            let plans = await WorkoutScheduler.shared.scheduledWorkouts
            let items: [[String: Any]] = plans.map { sched in
                var out: [String: Any] = [
                    "id": sched.plan.id.uuidString.lowercased(),
                    "complete": sched.complete
                ]
                if let iso = Self.isoDay(sched.date) { out["dateISO"] = iso }
                if let hour = sched.date.hour { out["hour"] = hour }
                if let minute = sched.date.minute { out["minute"] = minute }
                return out
            }
            call.resolve(["items": items])
        }
    }

    /** Remove every scheduled entry for this plan id (one occurrence = one id), optionally only
     *  on one day. Removal needs the full `WorkoutPlan`, so it goes through the scheduler's own
     *  list rather than reconstructing the plan from a spec that may since have been replanned. */
    @objc func remove(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.resolve(["matched": 0])
            return
        }
        forEachMatching(call) { await WorkoutScheduler.shared.remove($0.plan, at: $0.date) }
    }

    /** Tell Apple's list the session happened. OUR truth stays the HealthKit read-back — when the
     *  two disagree, ours wins; this only tidies the watch's list. */
    @objc func markComplete(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.resolve(["matched": 0])
            return
        }
        forEachMatching(call) { await WorkoutScheduler.shared.markComplete($0.plan, at: $0.date) }
    }

    @objc func removeAll(_ call: CAPPluginCall) {
        guard #available(iOS 17.0, *) else {
            call.resolve()
            return
        }
        Task {
            await WorkoutScheduler.shared.removeAllWorkouts()
            call.resolve()
        }
    }

    /** Shared walk for remove/markComplete: match by plan id (+ day when given), act, count. */
    @available(iOS 17.0, *)
    private func forEachMatching(
        _ call: CAPPluginCall,
        _ action: @escaping @Sendable (ScheduledWorkoutPlan) async -> Void
    ) {
        let id = (call.getString("id") ?? "").lowercased()
        let dateISO = call.getString("dateISO")
        Task {
            var matched = 0
            for sched in await WorkoutScheduler.shared.scheduledWorkouts {
                guard sched.plan.id.uuidString.lowercased() == id else { continue }
                if let dateISO, Self.isoDay(sched.date) != dateISO { continue }
                await action(sched)
                matched += 1
            }
            call.resolve(["matched": matched])
        }
    }

    // MARK: - Spec → WorkoutKit (decode only; every judgement was made in TypeScript)

    @available(iOS 17.0, *)
    private static func scheduleOne(_ item: JSObject) async throws {
        guard
            let spec = item["spec"] as? JSObject,
            let idString = spec["id"] as? String,
            let id = UUID(uuidString: idString),
            let body = spec["body"] as? JSObject,
            let workout = try makeWorkout(spec: spec, body: body),
            let components = dateComponents(item)
        else {
            throw PluginError.badSpec
        }
        await WorkoutScheduler.shared.schedule(WorkoutPlan(workout, id: id), at: components)
    }

    @available(iOS 17.0, *)
    private static func makeWorkout(spec: JSObject, body: JSObject) throws -> WorkoutPlan.Workout? {
        let activity = activityType(spec["activity"] as? String)
        let location = locationType(spec["location"] as? String)
        let name = spec["displayName"] as? String

        switch body["type"] as? String {
        case "pacer":
            guard
                let km = body["distanceKm"] as? Double,
                let sec = body["durationSec"] as? Double
            else { throw PluginError.badSpec }
            return .pacer(PacerWorkout(
                activity: activity,
                location: location,
                distance: Measurement(value: km, unit: UnitLength.kilometers),
                time: Measurement(value: sec, unit: UnitDuration.seconds)
            ))
        case "goal":
            guard let goal = goalOf(body["goal"] as? JSObject) else { throw PluginError.badSpec }
            return .goal(SingleGoalWorkout(activity: activity, location: location, goal: goal))
        case "custom":
            let blocks = (body["blocks"] as? [JSObject] ?? []).compactMap(blockOf)
            guard !blocks.isEmpty else { throw PluginError.badSpec }
            return .custom(CustomWorkout(
                activity: activity,
                location: location,
                displayName: name,
                warmup: goalOf(body["warmup"] as? JSObject).map { WorkoutStep(goal: $0) },
                blocks: blocks,
                cooldown: goalOf(body["cooldown"] as? JSObject).map { WorkoutStep(goal: $0) }
            ))
        default:
            throw PluginError.badSpec
        }
    }

    @available(iOS 17.0, *)
    private static func blockOf(_ raw: JSObject) -> IntervalBlock? {
        guard let iterations = raw["iterations"] as? Int, iterations > 0 else { return nil }
        let steps = (raw["steps"] as? [JSObject] ?? []).compactMap { stepRaw -> IntervalStep? in
            guard let goal = goalOf(stepRaw["goal"] as? JSObject) else { return nil }
            let purpose: IntervalStep.Purpose = (stepRaw["purpose"] as? String) == "recovery" ? .recovery : .work
            return IntervalStep(purpose, goal: goal)
        }
        guard !steps.isEmpty else { return nil }
        return IntervalBlock(steps: steps, iterations: iterations)
    }

    @available(iOS 17.0, *)
    private static func goalOf(_ raw: JSObject?) -> WorkoutGoal? {
        guard let raw else { return nil }
        switch raw["kind"] as? String {
        case "distance":
            guard let km = raw["km"] as? Double, km > 0 else { return nil }
            return .distance(km, .kilometers)
        case "time":
            guard let sec = raw["seconds"] as? Double, sec > 0 else { return nil }
            return .time(sec, .seconds)
        default:
            return nil
        }
    }

    /** Names arrive in WorkoutKit's own vocabulary (`WorkoutActivity` in workout-plan.ts maps
     *  1:1), so an unknown name is a version-skew bug — `.other` keeps the session schedulable
     *  while the skew is fixed rather than losing the workout over a label. */
    private static func activityType(_ name: String?) -> HKWorkoutActivityType {
        switch name {
        case "running": return .running
        case "walking": return .walking
        case "hiking": return .hiking
        case "cycling": return .cycling
        case "swimming": return .swimming
        case "rowing": return .rowing
        case "highIntensityIntervalTraining": return .highIntensityIntervalTraining
        case "functionalStrengthTraining": return .functionalStrengthTraining
        case "traditionalStrengthTraining": return .traditionalStrengthTraining
        case "coreTraining": return .coreTraining
        case "yoga": return .yoga
        default: return .other
        }
    }

    private static func locationType(_ name: String?) -> HKWorkoutSessionLocationType {
        switch name {
        case "outdoor": return .outdoor
        case "indoor": return .indoor
        default: return .unknown
        }
    }

    // MARK: - Dates

    /** A YYYY-MM-DD in the DEVICE's calendar (+ optional hour/minute) — the same wall-clock
     *  convention the identity plugin's one-shot trigger uses. */
    private static func dateComponents(_ item: JSObject) -> DateComponents? {
        guard let date = item["dateISO"] as? String else { return nil }
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        if let hour = item["hour"] as? Int { components.hour = hour }
        if let minute = item["minute"] as? Int { components.minute = minute }
        return components
    }

    private static func isoDay(_ components: DateComponents) -> String? {
        guard let y = components.year, let m = components.month, let d = components.day else { return nil }
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    private enum PluginError: LocalizedError {
        case badSpec
        var errorDescription: String? { "spec did not decode to a schedulable workout" }
    }
}
