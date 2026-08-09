import Foundation
import Capacitor
import Intents
import UIKit
import UserNotifications

/**
 Gives Cadence's notifications the coach's face.

 iOS lets an app donate an `INSendMessageIntent` describing who a message is from. Donate one and
 apply it to a notification's content, and the system renders that notification as a
 **communication notification**: the sender's portrait replaces the app icon, the app icon shrinks
 to a corner badge, and the app appears under "People" in Focus settings — so someone can let their
 coach through Do Not Disturb the same way they let a person through.

 That last part is the reason this exists. A notification from a portrait reads as someone
 speaking; a notification from an app icon reads as software. Cadence's whole voice is "I", and
 this is the one surface where the platform decides whether that lands.

 **Why this plugin also schedules.** `UNNotificationContent.updating(from:)` is the call that
 attaches the identity, and it can only be made on the content an app is about to post. For LOCAL
 notifications that content is built by whoever schedules them — so a donate-only plugin would
 register Cadence under "People" and change nothing about how a notification looks. Scheduling here
 is the minimum needed for the call to have an effect. It writes to the same
 `UNUserNotificationCenter` as `@capacitor/local-notifications`, so ids, cancellation and
 `getPending` all still work through that plugin; this only replaces the schedule step.

 Everything fails soft. No portrait, an unusable image, an OS that declines the donation — each
 returns `donated: false`, and the JS side falls back to the ordinary Capacitor scheduling path,
 which is exactly what shipped before the portrait existed.

 UNVERIFIED ON DEVICE: written without an Xcode build available. Needs a simulator run before it is
 trusted (see the PR description).
 */
@objc(CadenceCoachIdentityPlugin)
public class CadenceCoachIdentityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CadenceCoachIdentityPlugin"
    public let jsName = "CadenceCoachIdentity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "donate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleWithIdentity", returnType: CAPPluginReturnPromise)
    ]

    /// The most recent donated intent. Held so `scheduleWithIdentity` can decorate content with it
    /// without re-donating per notification — a donation per notification would fill the system's
    /// interaction store with duplicates of one relationship.
    private var donatedIntent: INSendMessageIntent?

    // MARK: - Donation

    @objc func donate(_ call: CAPPluginCall) {
        let senderName = call.getString("senderName") ?? "Cadence"
        let avatarBase64 = call.getString("avatarBase64") ?? ""

        // A malformed or absent portrait is a normal outcome (no face chosen, a failed fetch), not
        // an error worth surfacing — the caller falls back to the plain app icon.
        guard
            let data = Data(base64Encoded: avatarBase64),
            let uiImage = UIImage(data: data),
            // INImage wants encoded bytes, not a UIImage. Re-encoding normalises whatever the
            // webview handed us; 0.9 is indistinguishable at the size iOS renders an avatar.
            let jpeg = uiImage.jpegData(compressionQuality: 0.9)
        else {
            call.resolve(["donated": false])
            return
        }

        let intent = Self.makeIntent(senderName: senderName, avatar: jpeg)
        let interaction = INInteraction(intent: intent, response: nil)
        // .outgoing: the app is the sender. Marking it incoming files Cadence on the user's own
        // "sent" side of the system's model, which is not where a coach's message belongs.
        interaction.direction = .outgoing

        interaction.donate { [weak self] error in
            if let error = error {
                CAPLog.print("[CadenceCoachIdentity] donation failed: \(error.localizedDescription)")
                call.resolve(["donated": false])
                return
            }
            self?.donatedIntent = intent
            call.resolve(["donated": true])
        }
    }

    private static func makeIntent(senderName: String, avatar: Data) -> INSendMessageIntent {
        let image = INImage(imageData: avatar)
        let sender = INPerson(
            personHandle: INPersonHandle(value: "cadence.coach", type: .unknown),
            nameComponents: nil,
            displayName: senderName,
            image: image,
            contactIdentifier: nil,
            // Stable across donations, so iOS treats every Cadence notification as the same
            // "person" rather than accruing one entry per donation in Focus settings.
            customIdentifier: "cadence.coach"
        )
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: nil,
            speakableGroupName: nil,
            conversationIdentifier: "cadence.coach",
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
        intent.setImage(image, forParameterNamed: \.sender)
        return intent
    }

    // MARK: - Scheduling

    /**
     Schedule local notifications with the donated identity applied.

     Mirrors exactly the two trigger shapes the shared builder produces and nothing more. A weekly
     repeat occupies one of the OS's 64 pending slots and fires forever; a one-shot is how anything
     that depends on today works at all. There is no third shape, and adding one here without
     adding it there would be a notification nothing in the app knows it scheduled.
     */
    @objc func scheduleWithIdentity(_ call: CAPPluginCall) {
        guard let intent = donatedIntent else {
            // No donation yet: say so rather than scheduling plain notifications the JS side thinks
            // are decorated. It falls back to the ordinary Capacitor path.
            call.resolve(["scheduled": 0, "decorated": false])
            return
        }
        let specs = call.getArray("notifications", JSObject.self) ?? []
        let center = UNUserNotificationCenter.current()
        var scheduled = 0

        for spec in specs {
            guard
                let id = spec["id"] as? Int,
                let request = Self.makeRequest(spec: spec, id: id, intent: intent)
            else { continue }
            center.add(request) { error in
                if let error = error {
                    CAPLog.print("[CadenceCoachIdentity] schedule failed: \(error.localizedDescription)")
                }
            }
            scheduled += 1
        }
        call.resolve(["scheduled": scheduled, "decorated": true])
    }

    private static func makeRequest(spec: JSObject, id: Int, intent: INSendMessageIntent) -> UNNotificationRequest? {
        let content = UNMutableNotificationContent()
        content.title = spec["title"] as? String ?? ""
        content.body = spec["body"] as? String ?? ""
        content.sound = .default
        if let categoryId = spec["actionTypeId"] as? String, !categoryId.isEmpty {
            content.categoryIdentifier = categoryId
        }
        // The payload the action buttons read — notably the lighter day, composed at schedule time
        // so a tap never has to work anything out with the app cold.
        if let extra = spec["extra"] as? JSObject {
            content.userInfo = extra
        }

        guard let trigger = makeTrigger(spec: spec) else { return nil }

        // THE call this whole plugin exists for. It throws when the intent is not a valid
        // communication intent; a `try?` and an undecorated notification is a far better failure
        // than an app that dies while scheduling one.
        let finalContent = (try? content.updating(from: intent)) ?? content
        return UNNotificationRequest(identifier: String(id), content: finalContent, trigger: trigger)
    }

    private static func makeTrigger(spec: JSObject) -> UNNotificationTrigger? {
        let hour = spec["hour"] as? Int ?? 0
        let minute = spec["minute"] as? Int ?? 0

        if let weekday = spec["weekday"] as? Int {
            var components = DateComponents()
            components.weekday = weekday // 1 = Sunday, matching IosWeekday on the JS side
            components.hour = hour
            components.minute = minute
            return UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        }

        // One-shot: a YYYY-MM-DD in the DEVICE's own calendar, which is the same wall clock the
        // builder clamped against quiet hours.
        guard let date = spec["date"] as? String else { return nil }
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = hour
        components.minute = minute
        return UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
    }
}
