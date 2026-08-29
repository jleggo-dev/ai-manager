import Foundation
import Capacitor
import AuthenticationServices

/**
 OAuth through the API Apple built for it.

 The shipped flow opened the provider in `@capacitor/browser`'s SFSafariViewController and waited
 for the `cadence://` redirect to arrive as a deep link. On a fresh install's FIRST run, that
 redirect stalls inside the sheet — a custom-scheme navigation in a general browser needs iOS's
 confirmation and a user gesture — and the auth logs showed exactly that: Google done in 30s, the
 PKCE exchange arriving 70 seconds later, delivered only as the user swiped the stuck sheet away.
 The session was minted silently behind the sign-in gate and the user, seeing nothing, signed in
 twice (2026-08-29, owner device round).

 `ASWebAuthenticationSession` owns the callback scheme natively: no confirmation dialog, no
 gesture rule, the sheet dismisses itself, and the callback URL comes back HERE — never through
 the deep-link path at all. Cookies are shared with Safari (`prefersEphemeralWebBrowserSession =
 false`), so a returning user's Google session keeps the flow to seconds.

 Cancel resolves `{ cancelled: true }` rather than rejecting — someone closing the sheet is an
 answer, not an error.
 */
@objc(CadenceAuthSessionPlugin)
public class CadenceAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CadenceAuthSessionPlugin"
    public let jsName = "CadenceAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    private var current: ASWebAuthenticationSession?
    private var anchor: PresentationAnchorProvider?

    @objc func start(_ call: CAPPluginCall) {
        guard
            let urlString = call.getString("url"),
            let url = URL(string: urlString),
            let scheme = call.getString("callbackScheme")
        else {
            call.reject("start needs { url, callbackScheme }")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callbackUrl, error in
                self.current = nil
                self.anchor = nil
                if let callbackUrl {
                    call.resolve(["callbackUrl": callbackUrl.absoluteString])
                } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                    call.resolve(["cancelled": true])
                } else {
                    call.reject(error?.localizedDescription ?? "auth session failed")
                }
            }
            let anchor = PresentationAnchorProvider(window: self.bridge?.webView?.window)
            session.presentationContextProvider = anchor
            session.prefersEphemeralWebBrowserSession = false
            self.current = session
            self.anchor = anchor
            if !session.start() {
                self.current = nil
                self.anchor = nil
                call.reject("auth session could not start")
            }
        }
    }
}

/** ASWebAuthenticationSession wants a window to present from; the webview's own is the right one. */
private final class PresentationAnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    private weak var window: UIWindow?
    init(window: UIWindow?) { self.window = window }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return window ?? ASPresentationAnchor()
    }
}
