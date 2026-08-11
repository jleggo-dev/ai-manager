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
     * Makes the WKWebView visible to Safari's Web Inspector — the only way to see the console of
     * the app as it actually runs on a phone, which is where most of this app's bugs live.
     *
     * Set EXPLICITLY rather than relying on Capacitor's `#if DEBUG` default, because this project
     * consumes Capacitor through SPM: that `#if` is evaluated when the Capacitor *framework* was
     * compiled, not when the app is, so a debug app build can still ship a non-inspectable
     * webview. Capacitor's own source comments on that case. Guessing which way it fell is exactly
     * the kind of hunt that wastes an afternoon.
     *
     * ⚠️ MUST be gated before App Store submission — as written this applies to Release builds
     * too, and anyone with the device could then inspect the webview. Tracked in
     * docs/cadence/PLAN.md (backlog A0). Acceptable now: pre-launch, one device, one user.
     */
    webContentsDebuggingEnabled: true,
  },
};

export default config;
