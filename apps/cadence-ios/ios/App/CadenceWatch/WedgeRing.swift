import SwiftUI

/**
 The ring-as-session — the brand's signature, straight from intervalRing.ts: one wedge per
 phase, sized by its seconds, so the ring's shape IS the session's shape. Past wedges wear
 the DONE stop, the current one fills pro-rata in the FILL stop, and the shape ahead sits in
 track tint — which is why "what's left" never needs a caption.
 */
struct WedgeRing: View {
    let phases: [IntervalPhase]
    let index: Int
    let progress: Double
    var lineWidth: CGFloat = 10
    /** Visual gap between wedges, as a fraction of the circle (intervalRing.ts GAP≈1.2%). */
    private let gap = 0.013

    var body: some View {
        let total = max(1, phases.reduce(0) { $0 + max(0, $1.seconds) })
        Canvas { context, size in
            let r = min(size.width, size.height) / 2 - lineWidth / 2
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            var acc = 0.0
            for (i, phase) in phases.enumerated() {
                let span = Double(max(0, phase.seconds)) / Double(total)
                let arc = max(0.006, span - gap)
                let start = Angle(degrees: acc * 360 - 90)
                let base = i < index ? Theme.phaseDone(phase.kind) : Theme.phaseTrack(phase.kind)
                stroke(context, center: center, r: r, from: start, span: arc * 360, color: base)
                if i == index && progress > 0 {
                    stroke(context, center: center, r: r, from: start,
                           span: arc * 360 * min(1, progress), color: Theme.phaseFill(phase.kind))
                }
                acc += span
            }
        }
    }

    private func stroke(_ context: GraphicsContext, center: CGPoint, r: CGFloat,
                        from: Angle, span: Double, color: Color) {
        var path = Path()
        path.addArc(center: center, radius: r, startAngle: from,
                    endAngle: from + Angle(degrees: span), clockwise: false)
        context.stroke(path, with: .color(color),
                       style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
    }
}
