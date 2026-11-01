import UIKit
import Capacitor

/**
 Keeps the screen on while the metronome is clicking (owner, 2026-11-01).

 The click is WebAudio inside the webview, and iOS suspends the webview the moment the phone
 auto-locks — so a piano practice with nobody touching the glass went silent after the Auto-Lock
 delay. The ruling: the screen stays on while the metronome plays (the phone sits on the music
 stand, in view), rather than keeping the app alive in the background to click from a locked phone.

 Only the metronome asks for this. A timer step keeps time on the lock screen (CadenceLiveActivity)
 and the phone is meant to go in a pocket. One switch, no counting: the JS side holds it while a
 metronome runs and lets go when it stops or the step closes.
 */
@objc(CadenceKeepAwakePlugin)
public class CadenceKeepAwakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CadenceKeepAwakePlugin"
    public let jsName = "CadenceKeepAwake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    @objc func set(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }
}
