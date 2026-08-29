import SwiftUI
import WatchKit

/**
 Face 02 — the hero. The wedge ring around the countdown, phase word and numerals in the
 phase colour, tap pauses, a haptic marks every handover (the phone's colour+sound contract
 with the wrist's own channel added). Page 2 is the controls face: Pause · Skip phase · End,
 captioned with the player's own promise.

 The clock is a pure function of elapsed time (positionAt), exactly like the phone player —
 a backgrounded app resumes in the right phase because nothing was counting.
 */
struct IntervalPlayerView: View {
    let session: WatchSession
    @StateObject private var workout = WorkoutController()
    @State private var startDate: Date? = nil
    @State private var pausedElapsed: Double = 0
    @State private var lastHapticIndex = -1

    private var phases: [IntervalPhase] {
        IntervalEngine.expand(session.interval?.plan
            ?? IntervalPlan(warmupSec: 0, sets: [], restBetweenSetsSec: 0, cooldownSec: 0))
    }

    var body: some View {
        TabView {
            playerFace
            controlsFace
        }
        .tabViewStyle(.page)
        .navigationBarBackButtonHidden(startDate != nil)
        .onAppear { workout.requestAuthorization() }
        .onDisappear { workout.end() }
        .background(Color.black)
    }

    private var playerFace: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { timeline in
            let elapsed = currentElapsed(at: timeline.date)
            let at = IntervalEngine.position(in: phases, elapsed: elapsed)
            let phase = phases.indices.contains(at.index) ? phases[at.index] : nil
            let fill = Theme.phaseFill(phase?.kind ?? .neutral)

            VStack(spacing: 4) {
                if let round = phase?.globalRound {
                    Text("Round \(round) of \(IntervalEngine.totalRounds(session.interval?.plan ?? IntervalPlan(warmupSec: 0, sets: [], restBetweenSetsSec: 0, cooldownSec: 0)))")
                        .font(.footnote.weight(.bold)).foregroundStyle(Theme.linen)
                }
                ZStack {
                    WedgeRing(phases: phases, index: at.index, progress: at.progress, lineWidth: 8)
                    VStack(spacing: 0) {
                        Text(phase?.label ?? "Ready")
                            .font(.caption.weight(.heavy)).foregroundStyle(fill)
                        Text(clockText(at.remaining, elapsed: elapsed))
                            .font(.system(size: 44, weight: .heavy, design: .default))
                            .monospacedDigit()
                            .foregroundStyle(startDate == nil ? Theme.linen : fill)
                    }
                }
                HStack {
                    if let bpm = workout.heartRate {
                        Text("\(bpm)")
                            .font(.system(.body, design: .monospaced).weight(.bold))
                            .foregroundStyle(Theme.linen)
                        Text("bpm").font(.caption2.weight(.bold)).foregroundStyle(Theme.textMute)
                    }
                    Spacer()
                    Text(startDate == nil ? "tap to start" : "tap to pause")
                        .font(.caption2).foregroundStyle(Theme.textMute)
                }
            }
            .padding(.horizontal, 6)
            .contentShape(Rectangle())
            .onTapGesture(perform: toggle)
            .onChange(of: at.index) { _, newIndex in
                handover(to: newIndex)
            }
        }
    }

    private var controlsFace: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                controlButton(startDate == nil ? "Resume" : "Pause",
                              system: startDate == nil ? "play.fill" : "pause.fill",
                              tint: Theme.linen, action: toggle)
                controlButton("Skip phase", system: "forward.fill", tint: Theme.workFill) {
                    skipPhase()
                }
            }
            controlButton("End", system: "stop.fill", tint: Theme.sun) {
                workout.end()
            }
            Text("Stopping early keeps the rounds you did.")
                .font(.caption2).foregroundStyle(Theme.textMute)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 4)
    }

    private func controlButton(_ label: String, system: String, tint: Color,
                               action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: system)
                Text(label).font(.caption2.weight(.bold))
            }
            .frame(maxWidth: .infinity, minHeight: 56)
        }
        .tint(tint)
        .buttonStyle(.bordered)
    }

    // MARK: - Clock

    private func currentElapsed(at date: Date) -> Double {
        guard let startDate else { return pausedElapsed }
        return pausedElapsed + date.timeIntervalSince(startDate)
    }

    private func clockText(_ remaining: Int, elapsed: Double) -> String {
        let total = phases.reduce(0) { $0 + $1.seconds }
        let value = startDate == nil && elapsed == 0 ? total : remaining
        return String(format: "%d:%02d", value / 60, value % 60)
    }

    private func toggle() {
        if let started = startDate {
            pausedElapsed += Date().timeIntervalSince(started)
            startDate = nil
        } else {
            if pausedElapsed == 0 { workout.begin(occurrenceId: session.occurrenceId) }
            startDate = Date()
        }
    }

    private func skipPhase() {
        let at = IntervalEngine.position(in: phases, elapsed: currentElapsed(at: Date()))
        var acc = 0.0
        for (i, phase) in phases.enumerated() {
            acc += Double(phase.seconds)
            if i == at.index { break }
        }
        pausedElapsed = acc
        if startDate != nil { startDate = Date() }
    }

    private func handover(to index: Int) {
        guard startDate != nil, index != lastHapticIndex else { return }
        lastHapticIndex = index
        let kind = phases.indices.contains(index) ? phases[index].kind : .neutral
        WKInterfaceDevice.current().play(kind == .work ? .start : .stop)
    }
}
