import Foundation
import CoreText

/**
 Register the bundled brand faces at launch.

 Plus Jakarta Sans and Space Mono are the locked typefaces (BRAND.md; the watch brief:
 "Plus Jakarta Sans everywhere; Space Mono for data values only"). W1 shipped the system face
 because the repo had no font binaries at all — it loads them from Google Fonts by URL, which a
 watch app cannot do.

 **Registered in code rather than declared in `UIAppFonts`.** The watch target uses a GENERATED
 Info.plist (`GENERATE_INFOPLIST_FILE = YES` plus `INFOPLIST_KEY_*` settings), and Xcode has no
 `INFOPLIST_KEY_UIAppFonts` mapping — setting one is silently dropped, which was verified by
 inspecting the built plist rather than assumed. The alternative was hand-maintaining a full
 Info.plist and re-declaring `WKApplication`, the companion bundle id and both HealthKit usage
 strings; registering at launch is smaller and keeps those in one place.

 `.process` scope: the faces are available to this process only, which is all a watch app needs.
 A failure is silent by design — `Theme` falls back to the system face, so a missing font costs
 typography and never a blank screen.
 */
enum WatchFonts {
    /** Idempotent: registering the same URL twice logs an already-registered error we ignore. */
    private static var registered = false

    static func register() {
        guard !registered else { return }
        registered = true
        guard let urls = Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) else { return }
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}
