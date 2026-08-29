import SwiftUI

/**
 The brand, in the watch's own types. Every value is a styles.css token, a token at alpha,
 or a tone.ts stop converted oklch→sRGB (the conversion lives in the design record; the hex
 comments are approximate). Ground is TRUE BLACK by owner ruling 2026-08-29 — the hearth
 lives in the light, never in browned tints.

 TODO(fonts): Plus Jakarta Sans on watchOS needs the ttf embedded; the repo loads it from
 Google Fonts only, so W1 ships the system face and the swap is a build-phase chore, not a
 design question.
 */
enum Theme {
    // styles.css tokens
    static let linen = Color(red: 0.984, green: 0.976, blue: 0.957)      // #fbf9f4
    static let textMute = Color(red: 0.545, green: 0.553, blue: 0.569)   // #8b8d91
    static let textDim = Color(red: 0.361, green: 0.373, blue: 0.388)    // #5c5f63
    static let sage = Color(red: 0.545, green: 0.659, blue: 0.557)       // #8ba88e
    static let forest = Color(red: 0.173, green: 0.333, blue: 0.271)     // #2c5545
    static let sun = Color(red: 0.847, green: 0.353, blue: 0.188)        // #d85a30
    static let dusk = Color(red: 0.243, green: 0.361, blue: 0.463)       // #3e5c76
    static let line = Color(red: 0.863, green: 0.824, blue: 0.737)       // #dcd2bc

    // Derived, as the settled spec allows: linen/line at alpha, dusk lifted for black.
    static let card = linen.opacity(0.07)
    static let hairline = line.opacity(0.18)
    static let ghostBorder = line.opacity(0.28)
    static let duskLifted = Color(red: 0.561, green: 0.663, blue: 0.753) // dusk, lifted

    // tone.ts stops, verbatim values converted from oklch — keep in lockstep with
    // apps/cadence-web/src/features/walkthrough/tools/tone.ts.
    static let workFill = Color(red: 0.9833, green: 0.6497, blue: 0.1637)    // oklch(79% .16 70)
    static let workDone = Color(red: 0.7643, green: 0.4548, blue: 0.0)       // oklch(63% .15 68)
    static let recoverFill = Color(red: 0.3515, green: 0.6489, blue: 0.4402) // oklch(66% .11 152)
    static let recoverDone = Color(red: 0.238, green: 0.4694, blue: 0.3084)  // oklch(52% .09 152)

    static func phaseFill(_ kind: IntervalPhaseKind) -> Color {
        switch kind {
        case .work: return workFill
        case .recover: return recoverFill
        case .neutral: return textMute
        }
    }
    static func phaseDone(_ kind: IntervalPhaseKind) -> Color {
        switch kind {
        case .work: return workDone
        case .recover: return recoverDone
        case .neutral: return textDim
        }
    }
    static func phaseTrack(_ kind: IntervalPhaseKind) -> Color {
        phaseFill(kind).opacity(0.22)
    }
}
