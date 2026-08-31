import Foundation
import Capacitor
import WatchConnectivity

/**
 Pushes the committed week to OUR watch app (W2 — the sync slice).

 Distinct from `CadenceWorkoutPlan`, which schedules one session into APPLE's Workout app. This
 carries the whole projected week to Cadence on the wrist, so the watch can show the plan and run
 the sessions a wrist is good at.

 **This plugin makes no judgements.** Which sessions reach the wrist, how deep the detail rides,
 and what is shed to fit the transport are all decided in TypeScript (`buildWatchWeek` in
 `@cadence/shared`, unit-tested) and arrive here as a finished JSON string. The Swift below
 activates a session, reports what it can see, and hands the string across.

 **Why a string and not a dictionary.** `updateApplicationContext` accepts only property-list
 types. A JS object marshalled by Capacitor arrives as `JSObject` carrying `NSNull`s and nested
 arrays that would each have to be sanitised into that world — one missed `null` and the whole
 context throws, taking the entire week with it. One JSON string is one property-list value that
 cannot be malformed, and the watch decodes it with `JSONDecoder` against the same `Codable`
 shapes it would have used anyway.

 **Why application context and not a message.** It is a single latest-state slot: it coalesces
 (only the newest week matters), it is delivered when the watch next comes up rather than
 requiring it to be reachable now, and it never builds a backlog of stale weeks behind a watch
 that spent the week in a drawer. `sendMessage` would need a live counterpart; `transferUserInfo`
 would queue every week we ever sent.

 WatchConnectivity needs no entitlement and no usage string.
 */
@objc(CadenceWatchSyncPlugin)
public class CadenceWatchSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CadenceWatchSyncPlugin"
    public let jsName = "CadenceWatchSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "push", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingLogs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackLogs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushPortrait", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        // The delegate holds logs whether or not the webview is up; this hands it a way to WAKE
        // the webview when one lands while the app is running.
        WatchSyncSession.shared.onLogReceived = { [weak self] in
            self?.notifyListeners("logReceived", data: [:])
        }
        WatchSyncSession.shared.whenActivated { _ in }
    }

    /** The key the watch reads the week out of. Changing it is a breaking change on both sides. */
    static let contextKey = "cadence.week"

    /**
     One round-trip gate: is there anything on the other end at all?

     Answered only AFTER activation completes — `isPaired` and `isWatchAppInstalled` are
     meaningless before that, and answering early would report "no watch" to a phone that has one,
     which the JS layer would take as a settled answer and stop syncing.
     */
    @objc func getState(_ call: CAPPluginCall) {
        WatchSyncSession.shared.whenActivated { session in
            guard let session else {
                call.resolve(["supported": false, "paired": false, "installed": false])
                return
            }
            call.resolve([
                "supported": true,
                "paired": session.isPaired,
                "installed": session.isWatchAppInstalled
            ])
        }
    }

    /**
     Hand the week across.

     Reports the refusal rather than throwing it away: a payload past the context limit
     (`WCError.payloadTooLarge`) is the one failure that would otherwise be invisible, and it is
     exactly what the projection's byte budget exists to prevent. If it ever surfaces here, the
     budget is wrong — so it comes back as a reason a human can read.
     */
    @objc func push(_ call: CAPPluginCall) {
        guard let payload = call.getString("payload"), !payload.isEmpty else {
            call.resolve(["delivered": false, "reason": "empty payload"])
            return
        }
        WatchSyncSession.shared.whenActivated { session in
            guard let session else {
                call.resolve(["delivered": false, "reason": "WatchConnectivity unavailable"])
                return
            }
            guard session.isPaired, session.isWatchAppInstalled else {
                call.resolve(["delivered": false, "reason": "no watch app"])
                return
            }
            do {
                try session.updateApplicationContext([Self.contextKey: payload])
                call.resolve(["delivered": true])
            } catch {
                call.resolve(["delivered": false, "reason": error.localizedDescription])
            }
        }
    }

    // MARK: - The return leg

    /**
     Sessions the watch finished, waiting to be sent to the API.

     An outbox rather than a callback: `didReceiveUserInfo` fires on the NATIVE app, which is
     routinely awake when the webview is not (a transfer arriving while Cadence sits in the
     background). Holding them means a session logged on a wrist reaches the server on the next
     app open rather than being announced to nobody.
     */
    @objc func pendingLogs(_ call: CAPPluginCall) {
        let logs = WatchSyncSession.shared.pendingLogs().map { ["id": $0.id, "payload": $0.payload] }
        call.resolve(["logs": logs])
    }

    /** Forget logs the API has accepted. Anything NOT acknowledged is handed back next drain —
     *  at-least-once on purpose, because losing a session somebody did is the worse failure. */
    @objc func ackLogs(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        WatchSyncSession.shared.ack(ids)
        call.resolve()
    }

    /**
     Send the coach's chosen portrait to the watch.

     A FILE transfer rather than application context. The portraits are 20-30KB JPEGs; base64 in
     the week's context would spend most of its byte budget carrying a picture that changes almost
     never, and would couple a portrait to a plan sync. `transferFile` runs independently, in the
     background, and survives the watch being away.

     The face id rides as metadata so the watch can ignore a portrait it already has.
     */
    @objc func pushPortrait(_ call: CAPPluginCall) {
        guard let faceId = call.getString("faceId"), !faceId.isEmpty,
              let base64 = call.getString("jpegBase64"),
              let data = Data(base64Encoded: base64), !data.isEmpty else {
            call.resolve(["sent": false])
            return
        }
        WatchSyncSession.shared.whenActivated { session in
            guard let session, session.isPaired, session.isWatchAppInstalled else {
                call.resolve(["sent": false])
                return
            }
            // Written to a temp file because transferFile takes a URL. WatchConnectivity copies
            // it out before delivering, so cleaning up afterwards is the system's problem.
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("coach-\(faceId).jpg")
            do {
                try data.write(to: url, options: .atomic)
            } catch {
                call.resolve(["sent": false])
                return
            }
            session.transferFile(url, metadata: ["faceId": faceId])
            call.resolve(["sent": true])
        }
    }
}

/**
 The one `WCSession` for the process, and the activation it has to finish before anything it says
 is true.

 `WCSession` allows exactly one delegate, and activation is asynchronous — so callers queue on
 `whenActivated` and are drained once, in order, when the system answers. A session that fails to
 activate answers `nil` forever rather than retrying in a loop: the JS side treats "no watch" as a
 fact it can act on, and a retry storm behind a promise nobody resolves is worse than an honest no.
 */
final class WatchSyncSession: NSObject, WCSessionDelegate {
    static let shared = WatchSyncSession()

    /** One session finished on the watch, held until the web layer confirms the API stored it. */
    struct QueuedLog {
        let id: String
        let payload: String
    }

    private var pending: [(WCSession?) -> Void] = []
    private var activated = false
    private var failed = false
    private let lock = NSLock()

    /** Set by the plugin so a log arriving while the app runs wakes the webview immediately. */
    var onLogReceived: (() -> Void)?

    private var outbox: [QueuedLog] = []
    private static let outboxKey = "cadence.watch.logOutbox"
    private static let logKey = "cadence.log"

    /** Run `body` once the session is usable, on the main queue. Immediate if already activated. */
    func whenActivated(_ body: @escaping (WCSession?) -> Void) {
        guard WCSession.isSupported() else {
            DispatchQueue.main.async { body(nil) }
            return
        }
        lock.lock()
        if failed {
            lock.unlock()
            DispatchQueue.main.async { body(nil) }
            return
        }
        if activated {
            lock.unlock()
            DispatchQueue.main.async { body(WCSession.default) }
            return
        }
        pending.append(body)
        let shouldActivate = pending.count == 1
        lock.unlock()

        if shouldActivate {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
    }

    private func drain(with session: WCSession?) {
        lock.lock()
        let callbacks = pending
        pending = []
        lock.unlock()
        DispatchQueue.main.async { callbacks.forEach { $0(session) } }
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        lock.lock()
        if state == .activated && error == nil {
            activated = true
        } else {
            failed = true
        }
        let ok = activated
        lock.unlock()
        drain(with: ok ? session : nil)
    }

    // Required on iOS. A watch being switched costs us nothing to hold: the next push re-activates
    // and the application context is per-watch state the system re-establishes on its own.
    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        lock.lock()
        activated = false
        lock.unlock()
        WCSession.default.activate()
    }

    // MARK: - The return leg

    /**
     A session finished on the watch.

     `transferUserInfo` is queued and delivered even when the app is not running, which is exactly
     why this must persist rather than sit in memory: iOS may launch the app in the background to
     hand it over, and if the process dies before the webview drains the outbox, an in-memory
     queue loses a session somebody actually did.
     */
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let payload = userInfo[Self.logKey] as? String, !payload.isEmpty else { return }
        lock.lock()
        outbox = Self.readOutbox()
        outbox.append(QueuedLog(id: UUID().uuidString, payload: payload))
        Self.writeOutbox(outbox)
        lock.unlock()
        DispatchQueue.main.async { self.onLogReceived?() }
    }

    func pendingLogs() -> [QueuedLog] {
        lock.lock()
        defer { lock.unlock() }
        outbox = Self.readOutbox()
        return outbox
    }

    /** Drop acknowledged logs. Anything not named here survives to be handed over again. */
    func ack(_ ids: [String]) {
        guard !ids.isEmpty else { return }
        let drop = Set(ids)
        lock.lock()
        outbox = Self.readOutbox().filter { !drop.contains($0.id) }
        Self.writeOutbox(outbox)
        lock.unlock()
    }

    // UserDefaults rather than a file: the outbox is a handful of small strings that must survive
    // a process kill, which is precisely what it is for.
    private static func readOutbox() -> [QueuedLog] {
        let raw = UserDefaults.standard.array(forKey: outboxKey) as? [[String: String]] ?? []
        return raw.compactMap { row in
            guard let id = row["id"], let payload = row["payload"] else { return nil }
            return QueuedLog(id: id, payload: payload)
        }
    }

    private static func writeOutbox(_ logs: [QueuedLog]) {
        // Bounded: a phone that never opens must not accumulate a week of sessions unboundedly.
        // The newest are kept, because the oldest are the ones already least likely to matter.
        let kept = logs.suffix(50).map { ["id": $0.id, "payload": $0.payload] }
        UserDefaults.standard.set(kept, forKey: outboxKey)
    }
}
