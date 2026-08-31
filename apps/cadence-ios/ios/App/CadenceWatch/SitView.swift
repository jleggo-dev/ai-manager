import SwiftUI
import WatchKit
import HealthKit

/**
 Face 04 — the sit.

 **No heart rate on this face, ever.** The design brief says it twice and the plan says it once
 more: heart rate during a sit is a calm signal and nothing else — never a target, never a grade,
 and the coach never says a sit went better because a number went down. Hearth, not scoreboard.
 The simplest way to keep that promise is to never start a workout session here at all, so this
 face runs on the clock and the haptics alone.

 A sit is not exercise. HealthKit models it as `mindfulSession`, not a workout — writing one would
 file a meditation under training and let the watch count calories for it. Saving the sit as a
 mindful minute is a later slice; what must never happen is saving it as a workout.

 The "came back" tap is the honesty affordance: attention wanders, and noticing that it did IS the
 practice. It counts times returned, never a running total of failure.
 */
struct SitView: View {
    let session: WatchSession

    @State private var startDate: Date?
    @State private var pausedElapsed: Double = 0
    @State private var cameBack = 0
    @State private var finished = false
    @State private var startedAt: Date?
    @State private var sent = false
    @Environment(\.dismiss) private var dismiss

    /** The sit's length: the prescription's own seconds, else the session's minutes. */
    private var totalSeconds: Int {
        let fromItems = session.blocks
            .flatMap(\.items)
            .compactMap(\.durationSec)
            .reduce(0, +)
        return fromItems > 0 ? fromItems : max(60, session.minutes * 60)
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { timeline in
            let elapsed = currentElapsed(at: timeline.date)
            let remaining = max(0, totalSeconds - Int(elapsed.rounded(.down)))

            VStack(spacing: 8) {
                if finished || remaining == 0 {
                    doneFace
                } else {
                    sittingFace(remaining: remaining, elapsed: elapsed)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 8)
            .background(Color.black)
            .onChange(of: remaining) { _, value in
                if value == 0 && !finished { end() }
            }
        }
        .navigationTitle(session.title)
        .navigationBarBackButtonHidden(startDate != nil)
    }

    private func sittingFace(remaining: Int, elapsed: Double) -> some View {
        VStack(spacing: 10) {
            // Quiet remaining time. No ring, no progress bar — a sit is not a race against a bar.
            Text(clock(remaining))
                .font(Theme.mono(42, bold: false))
                .foregroundStyle(startDate == nil ? Theme.textMute : Theme.linen)

            Text(startDate == nil ? "when you're ready" : "settle in")
                .font(Theme.display(12, .regular, relativeTo: .caption2))
                .foregroundStyle(Theme.textDim)

            if startDate == nil {
                Button("Begin") { begin() }
                    .font(Theme.display(13, .bold, relativeTo: .caption))
                    .tint(Theme.dusk)
                    .buttonStyle(.borderedProminent)
            } else {
                Button {
                    noticed()
                } label: {
                    Text("I came back")
                        .font(Theme.display(12, .bold, relativeTo: .caption2))
                        .frame(maxWidth: .infinity)
                }
                .tint(Theme.duskLifted)
                .buttonStyle(.bordered)

                if cameBack > 0 {
                    // Counted, never scored: noticing is the practice, so this is a tally of
                    // something that went RIGHT.
                    Text("came back \(cameBack)×")
                        .font(Theme.display(11, .regular, relativeTo: .caption2))
                        .foregroundStyle(Theme.textDim)
                }
            }
        }
    }

    private var doneFace: some View {
        VStack(spacing: 8) {
            Image(systemName: "moon.stars")
                .font(.title3)
                .foregroundStyle(Theme.duskLifted)
            Text("That's done.")
                .font(Theme.display(17, .bold, relativeTo: .headline))
                .foregroundStyle(Theme.linen)
            Text("\(totalSeconds / 60) minutes")
                .font(Theme.mono(13))
                .foregroundStyle(Theme.textMute)
            if cameBack > 0 {
                Text("came back \(cameBack)×")
                    .font(Theme.display(11, .regular, relativeTo: .caption2))
                    .foregroundStyle(Theme.textDim)
            }
        }
    }

    // MARK: - Clock

    private func currentElapsed(at date: Date) -> Double {
        guard let startDate else { return pausedElapsed }
        return pausedElapsed + date.timeIntervalSince(startDate)
    }

    private func clock(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private func begin() {
        startDate = Date()
        if startedAt == nil { startedAt = Date() }
        // The starting bell — the sit's own chime, not a workout's start cue.
        WKInterfaceDevice.current().play(.start)
    }

    private func noticed() {
        cameBack += 1
        WKInterfaceDevice.current().play(.click)
    }

    private func end() {
        finished = true
        startDate = nil
        WKInterfaceDevice.current().play(.stop)
        saveMindfulSession()
        submit()
    }

    /**
     Report the sit.

     `cameBack` is counted because noticing that attention wandered IS the practice — it is never
     reported as a lapse, and the summary says so in words. No felt question and no mic here: the
     sit's Done face is deliberately quieter than a workout's.
     */
    private func submit() {
        guard !sent else { return }
        sent = true
        var log = WatchSessionLog(
            occurrenceId: session.occurrenceId,
            finishedAt: ISO8601DateFormatter().string(from: Date()),
            kind: session.kind.rawValue
        )
        log.elapsedSec = totalSeconds
        log.cameBack = cameBack
        WatchLogSender.shared.send(log)
    }

    /**
     Save the sit to Apple Health as a MINDFUL SESSION, never a workout.

     HealthKit models meditation as `mindfulSession`, and filing it as a workout would put a sit
     under training and let the watch count calories for it. This is also why no `HKWorkoutSession`
     runs on this face at all: the machinery that would measure heart rate is simply never started,
     which is the surest way to keep "no heart rate on the sit, ever".
     */
    private func saveMindfulSession() {
        guard HKHealthStore.isHealthDataAvailable(), let started = startedAt else { return }
        let store = HKHealthStore()
        let type = HKCategoryType(.mindfulSession)
        store.requestAuthorization(toShare: [type], read: []) { granted, _ in
            guard granted else { return } // refused is an answer; the sit still happened
            let sample = HKCategorySample(
                type: type,
                value: HKCategoryValue.notApplicable.rawValue,
                start: started,
                end: Date()
            )
            store.save(sample) { _, _ in }
        }
    }
}
