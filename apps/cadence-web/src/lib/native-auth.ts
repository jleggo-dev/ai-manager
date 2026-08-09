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

/** Providers offered on the sign-in screen. Apple is not optional — see AuthScreen. */
export type NativeOAuthProvider = 'google' | 'apple';

const PROVIDER_LABEL: Record<NativeOAuthProvider, string> = {
  google: 'Google',
  apple: 'Apple',
};

/**
 * Start OAuth from the native shell: get the provider URL from Supabase without navigating the
 * WebView, then hand it to the system browser sheet. Returns an error message for the auth screen
 * to show, or null on successful launch.
 *
 * Apple rides the identical path to Google (Supabase → system browser → `cadence://` deep link).
 * A native ASAuthorization sheet via `@capacitor-community/apple-sign-in` is a nicer UX and is
 * still worth doing, but it is a UX upgrade, not a requirement: guideline 4.8 asks that Sign in
 * with Apple be OFFERED, not that it use the system sheet. Shipping the shared path first means
 * App Store submission is not blocked on a new native dependency.
 */
export async function signInWithProviderNative(provider: NativeOAuthProvider): Promise<string | null> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    return error?.message?.trim() || `Could not start ${PROVIDER_LABEL[provider]} sign-in — try again.`;
  }
  await Browser.open({ url: data.url });
  return null;
}

/**
 * The same launch, but LINKING a provider to the session already in hand instead of starting a
 * new one. This is the sign-up gate's path: onboarding ran anonymously, the plan hangs off that
 * user id, and `signInWithOAuth` here would hand back a different id — a plan silently orphaned
 * at the exact moment someone agreed to keep it. Linking upgrades the id in place.
 */
export async function linkProviderNative(provider: NativeOAuthProvider): Promise<string | null> {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo: NATIVE_AUTH_CALLBACK, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    return error?.message?.trim() || `Could not start ${PROVIDER_LABEL[provider]} sign-in — try again.`;
  }
  await Browser.open({ url: data.url });
  return null;
}

/** @deprecated Use `signInWithProviderNative('google')`. Kept so existing callers keep compiling. */
export async function signInWithGoogleNative(): Promise<string | null> {
  return signInWithProviderNative('google');
}
