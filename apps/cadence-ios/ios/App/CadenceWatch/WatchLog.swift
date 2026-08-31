import Foundation
import WatchConnectivity

/**
 What happened, on its way back to the phone (watch app W2 — the return leg).

 KEEP IN LOCKSTEP with `packages/cadence-shared/src/watch-log.ts`: every property name here is a
 key `normalizeWatchLog` reads. The watch sends STRUCTURE — which steps were done, which reps were
 amended, how it felt — never prose. It knows the numbers; writing them into a sentence for the
 server to parse back out would be slower, lossier, and billed.

 The single free-text field is `note`, the mic on the Done face. That is the user's own words and
 goes to the coach's parse, exactly as a log typed on the phone does.
 */
struct WatchLogItem: Codable {
    let name: String
    let done: Bool
    var sets: Int? = nil
    var reps: Int? = nil
    /** What was asked. Sent so an amendment reads as an amendment — the plan learns more from
     *  "8 asked, 5 done" than from a bare 5. */
    var plannedReps: Int? = nil
}

struct WatchSessionLog: Codable {
    let occurrenceId: String
    /** Stamped when the session ENDED, not when it was sent. A transfer can sit queued for hours
     *  if the phone is away; dating it on arrival would put a 07:00 run at lunchtime. It is also
     *  the server's idempotency key, so it must not change between retries. */
    let finishedAt: String
    let kind: String
    var items: [WatchLogItem] = []
    var felt: String? = nil
    var note: String? = nil
    var rounds: Int? = nil
    var elapsedSec: Int? = nil
    var cameBack: Int? = nil
    /** `tracked` only — kilometres and active energy, as HealthKit measured them. */
    var distanceKm: Double? = nil
    var energyKcal: Int? = nil
}

/**
 Sends finished sessions to the phone, and keeps them until it is sure they left.

 `transferUserInfo`, not `updateApplicationContext`: context is a single latest-state slot that
 COALESCES, so logging two sessions before the phone is reachable would silently discard the
 first. `transferUserInfo` queues each one and delivers it in order, even if the phone is away
 until tomorrow.

 The local outbox is the second half of that guarantee. WatchConnectivity only queues once it has
 accepted a transfer; anything logged while the session has not activated — or while the app is
 about to be killed — would be lost without a copy on disk. A session somebody actually did is the
 one thing here worth being careful about.

 **This type is deliberately NOT a `WCSessionDelegate`.** `WCSession` allows exactly one, and
 `WatchStore` holds it to receive the week. A second assignment would silently replace the first
 and the watch would stop receiving plans. `WatchStore` calls `flush()` when the session activates.
 */
@MainActor
final class WatchLogSender: ObservableObject {
    static let shared = WatchLogSender()

    /** Matches `CadenceWatchSyncPlugin.logKey` — changing either breaks the return leg. */
    private static let logKey = "cadence.log"
    private static let outboxKey = "cadence.watch.pendingLogs"

    /**
     Queue a finished session and try to send it.

     Never throws and never blocks a face: the Done screen must dismiss whether or not a watch
     three feet from its phone happened to be reachable this second.
     */
    func send(_ log: WatchSessionLog) {
        var outbox = Self.readOutbox()
        outbox.append(log)
        Self.writeOutbox(outbox)
        flush()
    }

    /**
     Hand everything queued to WatchConnectivity.

     A log leaves the outbox only once `transferUserInfo` has ACCEPTED it — from that point iOS
     owns delivery and retries across launches on its own. Called on send and on app activation,
     so a session logged out of range goes as soon as the phone is back.
     */
    func flush() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        // Not activated yet: WatchStore owns activation and calls back here when it completes,
        // so the outbox simply waits rather than this racing it for the delegate slot.
        guard session.activationState == .activated else { return }

        let outbox = Self.readOutbox()
        guard !outbox.isEmpty else { return }

        for log in outbox {
            guard let data = try? JSONEncoder().encode(log),
                  let json = String(data: data, encoding: .utf8) else {
                continue // unencodable: dropping beats retrying a poison row forever
            }
            // Once WatchConnectivity accepts a transfer, iOS owns delivery and retries it across
            // launches by itself — so it is safe to drop from our own outbox here.
            session.transferUserInfo([Self.logKey: json])
        }
        Self.writeOutbox([])
    }

    // MARK: - Disk

    private static func readOutbox() -> [WatchSessionLog] {
        guard let data = UserDefaults.standard.data(forKey: outboxKey) else { return [] }
        return (try? JSONDecoder().decode([WatchSessionLog].self, from: data)) ?? []
    }

    private static func writeOutbox(_ logs: [WatchSessionLog]) {
        // Bounded so a watch that never meets its phone cannot grow without limit. Newest kept.
        let kept = Array(logs.suffix(50))
        UserDefaults.standard.set(try? JSONEncoder().encode(kept), forKey: outboxKey)
    }
}
