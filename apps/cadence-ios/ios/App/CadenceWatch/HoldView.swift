import SwiftUI
import WatchKit

/**
 Face 10 — hands full.

 A timed hold: a dead hang, a plank, a wall sit. The design brief's requirement is the whole
 design — **"Nothing needs a touch."** You cannot press a button while hanging off a bar, so the
 face runs itself: a "Get set" pre-roll, a chime to start on, a countdown, and an ending that
 arrives on its own with a second chime.

 That is why the pre-roll exists at all. Without it the hold starts the instant you tap, which
 means the clock is already running while you are still reaching for the bar — and every hold
 reads a second or two short. The pre-roll buys the time to get into position, and the chime is
 what tells you the hold has actually begun, since by then you are not looking at the watch.

 Double-tap skips ahead. It is Series 9 / Ultra 2 hardware and silently does nothing elsewhere,
 which is exactly why the copy on screen never mentions it: a promise the wrist cannot keep is
 worse than an undiscovered shortcut. The button is always there for everyone.
 */
struct HoldView: View {
    let exercise: WatchExercise
    let setLine: String
    /** Called when the hold finishes — by the clock, or by a skip. */
    let onDone: () -> Void

    @Environment(\.isLuminanceReduced) private var alwaysOn

    /** Seconds to get into position before the clock starts. Long enough to reach a bar, short
     *  enough not to feel like waiting. */
    private static let preRollSeconds = 5

    @State private var phase: Phase = .preRoll
    @State private var startedAt = Date()

    private enum Phase { case preRoll, holding, done }

    private var holdSeconds: Int { max(1, exercise.durationSec ?? 30) }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let elapsed = max(0, Int(timeline.date.timeIntervalSince(startedAt)))
            VStack(spacing: 4) {
                Text(exercise.name)
                    .font(Theme.display(13, .bold, relativeTo: .caption))
                    .foregroundStyle(Theme.linen)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)

                switch phase {
                case .preRoll:
                    preRoll(remaining: Self.preRollSeconds - elapsed)
                case .holding:
                    holding(remaining: holdSeconds - elapsed)
                case .done:
                    finished
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 8)
            .dimmedWhenAlwaysOn(alwaysOn)
        }
        // The clock that MATTERS runs here, not off the timeline tick. See `run()`.
        .task { await run() }
    }

    private func preRoll(remaining: Int) -> some View {
        VStack(spacing: 2) {
            Text("Get set")
                .font(Theme.display(15, .bold, relativeTo: .headline))
                .foregroundStyle(Theme.workFill)
            Text("\(max(0, remaining))")
                .font(Theme.mono(40))
                .foregroundStyle(Theme.linen)
            Text(setLine)
                .font(Theme.display(11, .regular, relativeTo: .caption2))
                .foregroundStyle(Theme.textDim)
        }
    }

    private func holding(remaining: Int) -> some View {
        VStack(spacing: 2) {
            Text("Hold")
                .font(Theme.display(15, .bold, relativeTo: .headline))
                .foregroundStyle(Theme.workFill)
            Text(sessionClock(max(0, remaining), alwaysOn: alwaysOn))
                .font(Theme.mono(alwaysOn ? 32 : 42))
                .foregroundStyle(Theme.linen)
            // No instruction to tap: the hold ends itself, and telling someone mid-plank to do
            // something is the opposite of what this face is for.
            Text("ends on its own")
                .font(Theme.display(10, .regular, relativeTo: .caption2))
                .foregroundStyle(Theme.textDim)
        }
    }

    private var finished: some View {
        VStack(spacing: 6) {
            Text("Done")
                .font(Theme.display(15, .bold, relativeTo: .headline))
                .foregroundStyle(Theme.sage)
            skipButton(label: "Next")
        }
    }

    /**
     The skip.

     Carries `handGestureShortcut(.primaryAction)` so a double-tap fires it on hardware that has
     one. On anything older the modifier is inert and the button is an ordinary button — which is
     why nothing on screen says "double-tap".
     */
    @ViewBuilder
    private func skipButton(label: String) -> some View {
        let button = Button(label) { finish(skipped: true) }
            .font(Theme.display(12, .bold, relativeTo: .caption2))
            .tint(Theme.sage)
            .buttonStyle(.borderedProminent)

        if #available(watchOS 11.0, *) {
            button.handGestureShortcut(.primaryAction)
        } else {
            button
        }
    }

    // MARK: - The clock

    /**
     Drive the hold on its own schedule, NOT off the display's tick.

     This is the load-bearing choice on this face. `PeriodicTimelineSchedule` throttles to roughly
     once a minute when the wrist is down, and a hold is exactly when the wrist is down — so
     advancing phases from the render tick would let the start chime land up to a minute late. On
     a face whose entire promise is "nothing needs a touch", a late chime is the whole feature
     failing.

     Sleeping to the deadline instead means the chime fires when it is due, dimmed or not, and the
     `TimelineView` above is free to update the digits as lazily as watchOS likes.
     */
    private func run() async {
        guard phase == .preRoll else { return }
        try? await Task.sleep(for: .seconds(Double(Self.preRollSeconds)))
        guard !Task.isCancelled, phase == .preRoll else { return }
        phase = .holding
        startedAt = Date()
        // The chime that says the hold has begun. By now nobody is looking at the screen, which
        // is the entire reason this is a sound and a haptic rather than a colour change.
        WKInterfaceDevice.current().play(.start)

        try? await Task.sleep(for: .seconds(Double(holdSeconds)))
        guard !Task.isCancelled, phase == .holding else { return }
        finish(skipped: false)
    }

    private func finish(skipped: Bool) {
        guard phase != .done else { return }
        phase = .done
        WKInterfaceDevice.current().play(skipped ? .click : .success)
        onDone()
    }
}
