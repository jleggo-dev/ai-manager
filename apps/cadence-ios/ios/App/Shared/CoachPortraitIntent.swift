import Foundation
import Intents
import UIKit

/**
 The `INSendMessageIntent` that puts the coach's portrait on a notification.

 Compiled into BOTH targets: local notifications are decorated by `CadenceCoachIdentityPlugin` at
 schedule time, remote ones by `CadenceNotificationService` at delivery time, and the two must
 describe the SAME sender. `conversationIdentifier` and `customIdentifier` are what iOS files the
 relationship under — if they disagreed, Cadence would appear twice under "People" in Focus
 settings and letting the coach through would only work for half her notifications.
 */
enum CoachPortraitIntent {
    /// Stable across every donation, in both targets. See the note above.
    static let conversationId = "cadence.coach"

    /// Cadence has one name and one voice; the portrait is a picture, never a persona.
    static let defaultSenderName = "Cadence"

    /// The intent for a portrait, or nil when the bytes are not a usable image.
    static func make(senderName: String = defaultSenderName, avatar: Data) -> INSendMessageIntent? {
        // INImage wants encoded bytes, not a UIImage. Re-encoding normalises whatever we were
        // handed; 0.9 is indistinguishable at the size iOS renders an avatar.
        guard
            let uiImage = UIImage(data: avatar),
            let jpeg = uiImage.jpegData(compressionQuality: 0.9)
        else { return nil }

        let image = INImage(imageData: jpeg)
        let sender = INPerson(
            personHandle: INPersonHandle(value: conversationId, type: .unknown),
            nameComponents: nil,
            displayName: senderName,
            image: image,
            contactIdentifier: nil,
            customIdentifier: conversationId
        )
        let intent = INSendMessageIntent(
            recipients: nil,
            outgoingMessageType: .outgoingMessageText,
            content: nil,
            speakableGroupName: nil,
            conversationIdentifier: conversationId,
            serviceName: nil,
            sender: sender,
            attachments: nil
        )
        // Setting the image on the intent as well as the INPerson is not redundant — it is the
        // one iOS reads when it renders the notification.
        intent.setImage(image, forParameterNamed: \.sender)
        return intent
    }

    /**
     Donate the interaction. This is what lets iOS attribute a notification to a sender at all.

     `.incoming` is load-bearing, and easy to get backwards: the direction is from the USER's point
     of view, not the app's. The coach sends, the user receives — so the interaction is incoming.
     Donated as `.outgoing` the system files it as a message the user themselves sent, leaving no
     sender to attribute anything to, and `updating(from:)` hands back undecorated content. That
     was the bug from #151 until now: every notification showed the app icon and nothing anywhere
     reported a failure.
     */
    static func donate(_ intent: INSendMessageIntent, completion: @escaping (Bool) -> Void) {
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        interaction.donate { error in
            if let error = error {
                NSLog("[CoachPortraitIntent] donation failed: %@", error.localizedDescription)
            }
            completion(error == nil)
        }
    }
}
