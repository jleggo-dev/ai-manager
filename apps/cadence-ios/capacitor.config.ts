import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Cadence iOS shell. The webDir is cadence-web's Vite output — build it with `--mode ios`
 * (npm run sync here does both) so the bundle carries the absolute API base from .env.ios
 * instead of the web-only /api rewrite.
 *
 * appId is the PLACEHOLDER bundle id — confirm before the first App Store submission
 * (it can never change after that) and register it in the Apple Developer portal.
 */
const config: CapacitorConfig = {
  appId: 'builders.cadence.app',
  appName: 'Cadence',
  webDir: '../cadence-web/dist',
  ios: {
    /**
     * A WKWebView honours pinch-zoom and KEEPS it. One stray two-finger touch while scrolling a
     * chat left every screen zoomed and panning side to side for the rest of the session, across
     * navigations, with no browser chrome to reset it. iOS deliberately ignores the viewport's
     * `user-scalable=no` in many cases, so the meta tag alone does not hold — this is the setting
     * that actually turns the gesture off. An app should always fit its screen.
     *
     * The accessibility answer is the OS one (Dynamic Type, Display Zoom), which applies device
     * wide and which the app respects; a webview scale the app cannot read or reset is not it.
     */
    zoomEnabled: false,

    /**
     * `webContentsDebuggingEnabled` is DELIBERATELY ABSENT — do not add it back.
     *
     * This file is static JSON by the time the app runs (`cap sync` copies it into the bundle),
     * so any value set here applies to Debug and Release alike. It was previously hardcoded
     * `true`, which meant every archive — TestFlight and App Store included — shipped a webview
     * that anyone holding the device could attach Safari's inspector to.
     *
     * Omitting the key hands the decision to Capacitor's own fallback in `CAPInstanceDescriptor`,
     * which is built for exactly this project's shape. Its `#if DEBUG` branch is useless to us:
     * we consume Capacitor as a prebuilt SPM xcframework, so that flag was resolved when Ionic
     * compiled the framework, not when this app compiles. Ionic's documented workaround for that
     * case is the `#else` branch — the `CAPACITOR_DEBUG` Info.plist string, which Info.plist has
     * always carried as `$(CAPACITOR_DEBUG)`. Nothing defined that build setting, so it expanded
     * to empty and the hardcoded `true` above was the only thing ever turning the inspector on.
     *
     * It is now a real per-configuration build setting in App.xcodeproj: `true` in Debug, `false`
     * in Release. Cable and simulator builds keep the inspector — which is where most of this
     * app's bugs are found — and archives do not, with no env var to remember and nothing to
     * toggle by hand before a release.
     */
  },
};

export default config;
