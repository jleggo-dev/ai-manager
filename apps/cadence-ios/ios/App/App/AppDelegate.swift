import UIKit
import AVFoundation
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        configureAudioSession()
        return true
    }

    /**
     The walkthrough's chimes (WebAudio in the webview) play under the default `.ambient`
     category, which the ring/silent switch mutes — the calf stretch's end bell did not sound on a
     phone set to silent (2026-09-06). `.playback` is heard regardless of the switch;
     `.mixWithOthers` keeps a podcast playing underneath rather than ducking or stopping it, which
     is exactly how the phone is used on a ruck. Nothing else in the app plays sound, so this
     applies to every chime and to nothing else.
     */
    private func configureAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // No audio session — the visual completion state carries the signal, as on the web.
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    /**
     Apple's answer to `registerForRemoteNotifications()` arrives HERE, at the app delegate, and
     Capacitor's PushNotifications plugin learns about it only through these two NotificationCenter
     posts. Without them iOS calls back, nothing is listening, and the JavaScript `registration`
     and `registrationError` events never fire — which is precisely what the device reported on
     2026-08-16: "[push] no APNs token after 10000ms — neither event fired".

     So `cadence.device_tokens` has been empty since the app existed, every push has settled as
     `no_devices`, and the owner has reported a missing notification in round after round. Not the
     entitlement (`aps-environment` is present and wired), not the App ID, not permission — the app
     was never told it had been given a token.

     These are scene-based-lifecycle safe: remote-notification registration is an APP-level
     callback and stays on the app delegate even with a SceneDelegate.
     */
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
