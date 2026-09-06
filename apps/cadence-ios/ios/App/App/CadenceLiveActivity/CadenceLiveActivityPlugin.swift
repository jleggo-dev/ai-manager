import Foundation
import Capacitor
import ActivityKit

/**
 The walkthrough timer on the lock screen and in the Dynamic Island.

 A Live Activity is the only surface iOS offers for "show me the clock without opening the app":
 the webview is suspended the moment the phone is pocketed, so the in-page ring goes dark, and a
 notification is a moment, not a clock. This plugin starts an activity when a timer runs, updates
 it on pause and resume, and ends it when the timer stops. The DRAWING lives in the widget
 extension (`ios/App/CadenceTimerWidget`); the shape they share is `Shared/TimerActivityAttributes`.

 **Nothing here counts time.** The JS side hands over instants — when the run began, how much was
 done before it, when the target lands — and the lock screen's `Text(timerInterval:)` counts on
 its own. That is what makes it work from a pocket: after `start` returns, the activity needs no
 further word from the app until the person touches the timer again.

 One activity at a time. A timer that starts ends whatever was showing first — a stale ruck from
 a run the app was killed in the middle of would otherwise sit on the lock screen for hours.

 The floor is iOS 16.2 (the project targets 15.0), so every use sits behind `@available` and
 answers honestly below it. No entitlement; `NSSupportsLiveActivities` in the app's Info.plist is
 the only switch. Everything fails soft: a refused or failed request resolves `started: false`
 and the timer carries on exactly as it did before this existed.
 */
@objc(CadenceLiveActivityPlugin)
public class CadenceLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CadenceLiveActivityPlugin"
    public let jsName = "CadenceLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    /// The running activity, boxed as `Any` because `Activity<…>` cannot be named below iOS 16.1
    /// and stored properties cannot carry `@available`.
    private var current: Any?

    // MARK: - Availability

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            call.resolve(["available": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["available": false])
        }
    }

    // MARK: - Lifecycle

    /**
     Start showing a timer. `startedAt` is epoch milliseconds; `baseSeconds` is what was done
     before this run (0 for a fresh start, the paused elapsed for a resume). Replaces any
     activity already showing.
     */
    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["started": false])
            return
        }
        let title = call.getString("title") ?? "Timer"
        let target = call.getInt("targetSeconds") ?? 0
        let base = call.getInt("baseSeconds") ?? 0
        guard target > 0, let startedMs = call.getDouble("startedAt") else {
            call.resolve(["started": false])
            return
        }
        let startedAt = Date(timeIntervalSince1970: startedMs / 1000)
        let state = Self.runningState(startedAt: startedAt, baseSeconds: base, targetSeconds: target)
        let attributes = TimerActivityAttributes(title: title, targetSeconds: target)

        Task {
            await Self.endAll()
            do {
                let activity = try Activity.request(
                    attributes: attributes,
                    content: ActivityContent(state: state, staleDate: nil),
                    pushType: nil
                )
                self.current = activity
                call.resolve(["started": true])
            } catch {
                CAPLog.print("[CadenceLiveActivity] start failed: \(error.localizedDescription)")
                call.resolve(["started": false])
            }
        }
    }

    /**
     Pause (`paused: true`, with `baseSeconds` = everything done so far) or resume (`paused:
     false`, with `startedAt` and `baseSeconds`) the activity that is showing. A no-op with no
     activity up.
     */
    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *), let activity = current as? Activity<TimerActivityAttributes> else {
            call.resolve()
            return
        }
        let base = call.getInt("baseSeconds") ?? 0
        let target = activity.attributes.targetSeconds
        let state: TimerActivityAttributes.ContentState
        if call.getBool("paused") ?? false {
            state = .init(startedAt: nil, baseSeconds: base, endsAt: nil, paused: true)
        } else if let startedMs = call.getDouble("startedAt") {
            state = Self.runningState(
                startedAt: Date(timeIntervalSince1970: startedMs / 1000),
                baseSeconds: base,
                targetSeconds: target
            )
        } else {
            call.resolve()
            return
        }
        Task {
            await activity.update(ActivityContent(state: state, staleDate: nil))
            call.resolve()
        }
    }

    /// Take the timer off the lock screen. Always safe to call.
    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            await Self.endAll()
            self.current = nil
            call.resolve()
        }
    }

    // MARK: - Helpers

    @available(iOS 16.2, *)
    private static func runningState(startedAt: Date, baseSeconds: Int, targetSeconds: Int)
        -> TimerActivityAttributes.ContentState
    {
        let remaining = max(0, targetSeconds - baseSeconds)
        return .init(
            startedAt: startedAt,
            baseSeconds: baseSeconds,
            endsAt: startedAt.addingTimeInterval(Double(remaining)),
            paused: false
        )
    }

    /// Ends EVERY timer activity this app has up, not only the one this instance remembers — the
    /// app may have been relaunched with a stale one still on the lock screen.
    @available(iOS 16.2, *)
    private static func endAll() async {
        for activity in Activity<TimerActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}
