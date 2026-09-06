import Foundation
import WatchConnectivity

/**
 The week, as the watch holds it (W2 — the sync slice).

 One `WCSession` delegate, one published payload, and a copy on disk. The phone pushes the
 committed week into the application context (`CadenceWatchSyncPlugin`); this receives it,
 decodes it against the shapes in `WatchSession.swift`, and republishes.

 **The persisted copy is the load-bearing part.** Application context is delivered when the system
 feels like delivering it — a cold launch reads the last context eventually, not immediately, and
 a watch launched away from its phone may get nothing at all. Without a disk copy the first paint
 of every launch is an empty week, which on a wrist reads as "the app is broken", not "one moment".
 The phone learned this exact lesson at boot (PERF-09, the boot cache): the paint has to outlive
 the process.

 Freshness is honest rather than hidden: `lastSyncedAt` is what a face shows when the week it is
 drawing came from disk rather than from the phone just now.
 */
@MainActor
final class WatchStore: NSObject, ObservableObject {
    @Published private(set) var week: WatchWeekPayload
    /** When the currently-held week arrived. Nil = nothing has ever synced (sample data). */
    @Published private(set) var lastSyncedAt: Date?
    /** True while the app has never received a real week — the faces say so rather than pretending. */
    @Published private(set) var isSample: Bool
    /**
     The coach's chosen portrait, once the phone has sent it.

     Nil until then, and `CoachPortrait` falls back to the bundled stand-in — which is a real
     picture of a coach, so the fallback is a different face rather than a broken one. The synced
     choice replacing it is the point: the portrait is the user's, not ours.
     */
    @Published private(set) var portraitURL: URL?
    /**
     Which day the wrist is standing in — `YYYY-MM-DD`, from the WATCH's clock.

     The payload's `isToday` was the phone's opinion when it synced, and it went stale at
     midnight: a week pushed on Sunday evening kept the Today face on "Sunday" all of Monday until
     the phone's Plan tab happened to open again. The clock is the only thing that knows what day
     it is now, so every face asks it, and the phone's flag is not consulted at all.
     */
    @Published private(set) var todayISO: String = WatchCalendar.iso()

    /** Today's row, if the held week has one. Nil means the week does not reach today — the faces
     *  say so rather than drawing the wrong day as if it were this one. */
    var today: WatchDay? { week.day(on: todayISO) }

    func isToday(_ day: WatchDay) -> Bool { day.date == todayISO }

    /** Re-read the clock. Called when the day changes under a running app and whenever the app
     *  comes to the front — a wrist app is routinely suspended across midnight. */
    func refreshToday() {
        let now = WatchCalendar.iso()
        if now != todayISO { todayISO = now }
    }

    private static let fileName = "watch-week.json"
    private static let syncedAtKey = "cadence.week.syncedAt"

    override init() {
        if let saved = Self.readFromDisk() {
            week = saved
            isSample = false
            let stamp = UserDefaults.standard.double(forKey: Self.syncedAtKey)
            lastSyncedAt = stamp > 0 ? Date(timeIntervalSince1970: stamp) : nil
        } else {
            // Never synced. Sample data keeps every face walkable in the simulator rather than
            // showing a rest day that is a lie about an empty cache.
            week = SampleWeek.payload
            isSample = true
            lastSyncedAt = nil
        }
        portraitURL = Self.savedPortrait()
        super.init()
        // Midnight under a running app. The system posts this on its own queue; the store is
        // main-actor, so the hop is explicit.
        NotificationCenter.default.addObserver(
            forName: .NSCalendarDayChanged, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refreshToday() }
        }
    }

    /** Begin listening. Safe to call more than once; `activate()` on an active session is a no-op. */
    func start() {
        refreshToday()
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        // Anything logged while the app was last running but never sent.
        WatchLogSender.shared.flush()
        // The context already waiting from a previous launch — `didReceiveApplicationContext` only
        // fires for NEW ones, so a launch after a push would otherwise sit on stale disk data
        // until the phone happened to change something.
        adopt(session.receivedApplicationContext)
    }

    /**
     Take a context dictionary if it carries a week we understand.

     A payload from a newer phone is REFUSED rather than half-decoded: partial data on a wrist is
     worse than old data, because the user cannot tell which fields are missing. Refusing leaves
     the last good week on screen, which is at least internally consistent.
     */
    func adopt(_ context: [String: Any]) {
        guard let json = context[Self.contextKey] as? String,
              let data = json.data(using: .utf8) else { return }
        guard let decoded = try? JSONDecoder().decode(WatchWeekPayload.self, from: data),
              decoded.version == WatchWeekPayload.currentVersion else { return }

        week = decoded
        isSample = false
        lastSyncedAt = Date()
        Self.writeToDisk(data)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.syncedAtKey)
    }

    /** Matches `CadenceWatchSyncPlugin.contextKey` — changing either breaks the sync. */
    static let contextKey = "cadence.week"

    // MARK: - The coach's portrait

    private static let portraitName = "coach-portrait.jpg"
    private static let portraitFaceKey = "cadence.portrait.faceId"

    /** The synced portrait on disk, if one has ever arrived. */
    private static func savedPortrait() -> URL? {
        guard let url = portraitFileURL, FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }

    private static var portraitFileURL: URL? {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent(portraitName)
    }

    /**
     Adopt a portrait the phone transferred.

     Takes BYTES, not a URL: WatchConnectivity reclaims the delivered file the moment its delegate
     method returns, so the read happens there and this only has to persist and publish.
     */
    func adoptPortrait(_ data: Data, faceId: String?) {
        guard let destination = Self.portraitFileURL else { return }
        try? FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        guard (try? data.write(to: destination, options: .atomic)) != nil else { return }
        if let faceId { UserDefaults.standard.set(faceId, forKey: Self.portraitFaceKey) }
        // Reassigning the same URL would not redraw, so publish nil first — the face is on screen
        // and has to actually change.
        portraitURL = nil
        portraitURL = destination
    }

    // MARK: - Disk

    private static var fileURL: URL? {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent(fileName)
    }

    private static func readFromDisk() -> WatchWeekPayload? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        guard let decoded = try? JSONDecoder().decode(WatchWeekPayload.self, from: data),
              decoded.version == WatchWeekPayload.currentVersion else { return nil }
        return decoded
    }

    private static func writeToDisk(_ data: Data) {
        guard let url = fileURL else { return }
        // A failed write costs the NEXT launch its warm paint and nothing else — the week in
        // memory is already published. Never worth interrupting a session over.
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(), withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }
}

extension WatchStore: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith state: WCSessionActivationState,
        error: Error?
    ) {
        guard state == .activated, error == nil else { return }
        let context = session.receivedApplicationContext
        Task { @MainActor in
            self.adopt(context)
            // WatchStore holds the one delegate slot, so it is also what tells the log outbox the
            // session is usable. Anything logged out of range goes now.
            WatchLogSender.shared.flush()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        Task { @MainActor in self.adopt(context) }
    }

    /**
     The coach's portrait, sent as a file because it is far too large for application context.

     **The bytes are read HERE, synchronously.** WatchConnectivity reclaims `file.fileURL` as soon
     as this method returns, so hopping to another actor with the URL and reading it there is a
     race that loses the portrait — the first cut of this method did exactly that.
     */
    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard let data = try? Data(contentsOf: file.fileURL), !data.isEmpty else { return }
        let faceId = file.metadata?["faceId"] as? String
        Task { @MainActor in self.adoptPortrait(data, faceId: faceId) }
    }
}
