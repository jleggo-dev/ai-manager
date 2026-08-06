import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from './supabase.ts';

/**
 * OAuth on the native (Capacitor iOS) shell. A WKWebView can't ride the normal web redirect —
 * `window.location.origin` is capacitor://localhost, which Google/Supabase can't return to. So on
 * native the flow is: open the Supabase auth URL in the system browser sheet, let Supabase
 * redirect to our custom scheme, catch it here via appUrlOpen, and exchange the PKCE code for a
 * session. App's onAuthStateChange listener then takes over exactly as on web.
 *
 * The callback URL must be allowlisted in the Supabase dashboard (Auth → URL Configuration).
 */
export const NATIVE_AUTH_CALLBACK = 'cadence://auth-callback';

export const isNativeShell = () => Capacitor.isNativePlatform();

/** Wire the deep-link listener. Call once at startup; no-op outside the native shell. */
export function initNativeAuth(): void {
  if (!isNativeShell()) return;
  void App.addListener('appUrlOpen', ({ url }) => {
    if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;
    const code = new URL(url).searchParams.get('code');
    void Browser.close().catch(() => undefined); // dismiss the sheet even if close is a no-op
    if (code) void supabase.auth.exchangeCodeForSession(code);
  });
}

/**
 * Start Google sign-in from the native shell: get the provider URL from Supabase without
 * navigating the WebView, then hand it to the system browser sheet. Returns an error message
 * for the auth screen to show, or null on successful launch.
 */
export async function signInWithGoogleNative(): Promise<string | null> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return error?.message?.trim() || 'Could not start Google sign-in — try again.';
  await Browser.open({ url: data.url });
  return null;
}
