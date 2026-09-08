import UIKit
import Capacitor

/**
 The bridge, subclassed for one job: registering the plugins that are compiled into THIS target.

 Capacitor 6 stopped scanning the Objective-C runtime for plugin classes. `CapacitorBridge
 .registerPlugins()` (capacitor-swift-pm 8.5.0) loads exactly two things — its own built-ins and
 the `packageClassList` in the generated `capacitor.config.json` — and `cap sync` fills that list
 from the npm packages in `CapApp-SPM/Package.swift` and nothing else. A `CAPBridgedPlugin` that
 lives in the App target is invisible to it: the class is in the binary, `@objc(...)` and all, and
 the bridge never hears of it.

 So every `registerPlugin('CadenceCoachIdentity')` call from JS rejected with Capacitor's
 `"CadenceCoachIdentity" plugin is not implemented on ios`, the catch in `capability/native.ts`
 swallowed it, scheduling fell through to the plain `@capacitor/local-notifications` path, and the
 coach's portrait never once reached a notification — through the entitlement fix (#312), the
 extension (#351, #374) and the `.incoming` fix, none of which could have shown, because the code
 they fixed was never called. Owner, 2026-09-07: "I still don't see the coach's avatar on the
 notifications." Nothing logged, because "plugin absent" was designed as a quiet fallback for the
 WEB build, and it covered the device just as quietly. The same silence covered the other four
 plugins in this folder: none of them has ever been registered either, which is consistent with all
 four still being marked NOT DEVICE-VERIFIED in their READMEs.

 `registerPluginInstance` is the documented hook and the ONLY one that works here —
 `registerPluginType` returns early while `autoRegisterPlugins` is on (the default), silently.
 `capacitorDidLoad` runs once the bridge exists and before the webview loads, so the plugins are
 exported to JS before the first line of app code can call them.

 Both places the app instantiates its root controller must point here: `SceneDelegate` (the one
 that is actually shown) and `Main.storyboard` (still named by `UISceneStoryboardFile`). A bare
 `CAPBridgeViewController` in either is this bug again.
 */
class CadenceBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CadenceCoachIdentityPlugin())
        bridge?.registerPluginInstance(CadenceAuthSessionPlugin())
        bridge?.registerPluginInstance(CadenceWorkoutPlanPlugin())
        bridge?.registerPluginInstance(CadenceWatchSyncPlugin())
        bridge?.registerPluginInstance(CadenceLiveActivityPlugin())
    }
}
