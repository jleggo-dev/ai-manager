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
  appId: 'dev.jleggo.cadence',
  appName: 'Cadence',
  webDir: '../cadence-web/dist',
};

export default config;
