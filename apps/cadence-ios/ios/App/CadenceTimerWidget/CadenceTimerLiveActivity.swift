import ActivityKit
import SwiftUI
import WidgetKit

/**
 The timer as it appears on the lock screen (the banner) and in the Dynamic Island.

 Two numbers, deliberately. The big one counts DOWN to the target and then sits at 0:00; the small
 one counts UP from the moment the effort began and never stops. Together they read correctly on
 both sides of the target with no update from the app: before it, "12:40 left · 37:20 of 50:00";
 after it, "0:00 left · 1:32:10 of 50:00" — the ruck has run long, and the lock screen says so
 without the app ever having been awake to tell it.

 The one state the app has to speak for is a pause: the instants are gone, so the elapsed count
 is drawn as a fixed number and labelled.

 Colours are the walkthrough's own warm tone, drawn by hand — a widget cannot load the web CSS.
 */
@available(iOS 16.2, *)
struct CadenceTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerActivityAttributes.self) { context in
            LockScreenBanner(context: context)
                .activityBackgroundTint(TimerTone.ground)
                .activitySystemActionForegroundColor(TimerTone.ink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.title, systemImage: "figure.walk")
                        .font(.headline)
                        .lineLimit(1)
                        .foregroundStyle(TimerTone.ink)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(state: context.state, size: 28)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ElapsedLine(context: context)
                }
            } compactLeading: {
                Image(systemName: "figure.walk").foregroundStyle(TimerTone.accent)
            } compactTrailing: {
                Countdown(state: context.state, size: 15)
            } minimal: {
                Countdown(state: context.state, size: 12)
            }
        }
    }
}

// MARK: - Pieces

@available(iOS 16.2, *)
private struct LockScreenBanner: View {
    let context: ActivityViewContext<TimerActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(context.attributes.title)
                    .font(.headline)
                    .foregroundStyle(TimerTone.ink)
                    .lineLimit(1)
                Spacer()
                Text(context.state.paused ? "PAUSED" : "LEFT")
                    .font(.caption2.weight(.heavy))
                    .tracking(1)
                    .foregroundStyle(TimerTone.sub)
            }
            Countdown(state: context.state, size: 40)
            ElapsedLine(context: context)
            if let from = context.state.elapsedFrom, let end = targetEnd(from: from) {
                ProgressView(timerInterval: from...end, countsDown: false, label: { EmptyView() }, currentValueLabel: { EmptyView() })
                    .tint(TimerTone.accent)
            }
        }
        .padding(14)
    }

    /// The instant the target lands, measured from the effort's start — the progress bar's end.
    private func targetEnd(from: Date) -> Date? {
        let end = from.addingTimeInterval(Double(context.attributes.targetSeconds))
        return end > from ? end : nil
    }
}

/// The big number: remaining time, counting down on its own and resting at 0:00 past the target.
/// Paused, it is the elapsed time as a fixed figure — there is nothing to count down from.
@available(iOS 16.2, *)
private struct Countdown: View {
    let state: TimerActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        Group {
            if let from = state.startedAt, let to = state.endsAt, to > from {
                Text(timerInterval: from...to, countsDown: true)
            } else if let from = state.startedAt, state.endsAt != nil {
                Text("0:00")
            } else {
                Text(TimerTone.mmss(state.baseSeconds))
            }
        }
        .font(.system(size: size, weight: .semibold, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(state.paused ? TimerTone.sub : TimerTone.ink)
    }
}

/// The small line: "37:20 of 50:00", the elapsed half counting up forever.
@available(iOS 16.2, *)
private struct ElapsedLine: View {
    let context: ActivityViewContext<TimerActivityAttributes>

    var body: some View {
        HStack(spacing: 4) {
            if let from = context.state.elapsedFrom {
                Text(timerInterval: from...Date.distantFuture, countsDown: false)
                    .monospacedDigit()
            } else {
                Text(TimerTone.mmss(context.state.baseSeconds)).monospacedDigit()
            }
            Text("of \(TimerTone.mmss(context.attributes.targetSeconds))")
        }
        .font(.caption.weight(.bold))
        .foregroundStyle(TimerTone.sub)
    }
}

/// The walkthrough's warm tone (tone.ts), by hand — the widget has no access to the web CSS.
enum TimerTone {
    static let ground = Color(red: 0.99, green: 0.97, blue: 0.93)
    static let ink = Color(red: 0.20, green: 0.17, blue: 0.13)
    static let sub = Color(red: 0.50, green: 0.45, blue: 0.38)
    static let accent = Color(red: 0.87, green: 0.58, blue: 0.20)

    static func mmss(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, sec)
            : String(format: "%d:%02d", m, sec)
    }
}
