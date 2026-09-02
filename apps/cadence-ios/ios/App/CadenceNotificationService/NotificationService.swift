import Intents
import UserNotifications

/**
 Puts the coach's portrait on a REMOTE notification.

 `CadenceCoachIdentityPlugin` can only decorate notifications it schedules itself: `updating(from:)`
 is a call on content about to be posted, and for a push that content is built by APNs, not by us.
 So every server-sent notification — the plan-ready ping, the nudge dispatcher — arrived with the
 plain app icon no matter what the app had donated. This extension is the only place that call can
 be made for a push, which is why it exists.

 iOS runs it only when the payload carries `mutable-content: 1` (see `services/push-apns.ts`), and
 allows it roughly 30 seconds. Everything here is well inside that: read an id, read a bundled
 JPEG, decorate.

 Fails soft in every direction. No face chosen, an id we don't recognise, an unreadable file, an OS
 that refuses the donation — each delivers the ORIGINAL content, which is exactly the notification
 that shipped before the portrait existed. The face is a nicety; the notification is the thing that
 must not break.
 */
class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var original: UNNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        self.original = request.content

        guard
            let faceId = request.content.userInfo["face_id"] as? String,
            let avatar = Self.portrait(faceId: faceId),
            let intent = CoachPortraitIntent.make(avatar: avatar)
        else {
            // No face chosen is a real answer, not a missing one: the app icon is the honest thing
            // to show when someone has not picked a portrait, rather than assigning them one.
            contentHandler(request.content)
            return
        }

        CoachPortraitIntent.donate(intent) { donated in
            guard donated, let decorated = try? request.content.updating(from: intent) else {
                contentHandler(request.content)
                return
            }
            contentHandler(decorated)
        }
    }

    /// The OS is about to give up on us. Deliver what we were handed rather than nothing at all.
    override func serviceExtensionTimeWillExpire() {
        if let handler = contentHandler, let original = original { handler(original) }
    }

    /**
     A portrait from the extension's own bundle.

     The JPEGs are a folder reference to `apps/cadence-web/public/avatars` — the same files the web
     app serves, so a portrait cannot exist in one place and not the other, and adding one is still
     a single drop into a single directory.

     The id travels in the push payload rather than through shared storage on purpose. An extension
     cannot read the app's container without an App Group, and a portrait that depended on the app
     having recently run would be missing for exactly the first push a new user ever gets — the one
     that says their first week is ready.
     */
    private static func portrait(faceId: String) -> Data? {
        // The id comes off the network. It only ever indexes a bundled file, but a separator or a
        // dot would still be a path to somewhere else, so take plain file names and nothing more.
        guard !faceId.isEmpty, !faceId.contains("/"), !faceId.contains(".") else { return nil }
        guard let url = Bundle.main.url(forResource: faceId, withExtension: "jpg", subdirectory: "avatars") else {
            return nil
        }
        return try? Data(contentsOf: url)
    }
}
