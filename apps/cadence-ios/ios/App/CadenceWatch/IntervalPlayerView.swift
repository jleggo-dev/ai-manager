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
    @EnvironmentObject private var workout: WorkoutController
    @State private var startDate: Date? = nil
    @State private var pausedElapsed: Double = 0
    @State private var lastHapticIndex = -1
    @State private var finished = false
    @Environment(\.dismiss) private var dismiss
    /** Always-On. The brief for face 11: dim ring, numeral in the DONE stop, no HR. */
    @Environment(\.isLuminanceReduced) private var alwaysOn

    private var phases: [IntervalPhase] {
        IntervalEngine.expand(session.interval?.plan
            ?? IntervalPlan(warmupSec: 0, sets: [], restBetweenSetsSec: 0, cooldownSec: 0))
    }

    var body: some View {
        Group {
            if finished {
                DoneView(session: session, facts: facts, onFinish: submit)
            } else {
                TabView {
                    playerFace
                    controlsFace
                }
                .tabViewStyle(.page)
            }
        }
        .navigationBarBackButtonHidden(startDate != nil && !finished)
        .onAppear { workout.requestAuthorization() }
        .onDisappear { workout.end() }
        .background(Color.black)
    }

    /**
     The three facts the Done face shows — rounds DONE, time moved, average heart rate.

     Rounds completed is counted from the phases actually walked, so stopping early keeps the
     rounds you did. That is the controls page's written promise, and this is where it has to be
     true rather than merely stated.
     */
    private var facts: [DoneFact] {
        let elapsed = currentElapsed(at: Date())
        let done = IntervalEngine.roundsCompleted(phases, elapsed: elapsed)
        var out: [DoneFact] = [
            DoneFact(label: "rounds", value: "\(done)"),
            DoneFact(label: "moved", value: String(format: "%d:%02d", Int(elapsed) / 60, Int(elapsed) % 60)),
        ]
        if let bpm = workout.averageHeartRate {
            out.append(DoneFact(label: "avg bpm", value: "\(bpm)"))
        }
        return out
    }

    private var playerFace: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { timeline in
            let elapsed = currentElapsed(at: timeline.date)
            let at = IntervalEngine.position(in: phases, elapsed: elapsed)
            let phase = phases.indices.contains(at.index) ? phases[at.index] : nil
            // The done stop when dimmed, exactly as face 11 specifies — a phase colour at full
            // brightness on an always-on screen both costs battery and overstates how live it is.
            let kind = phase?.kind ?? .neutral
            let fill = alwaysOn ? Theme.phaseDone(kind) : Theme.phaseFill(kind)

            VStack(spacing: 4) {
                if let round = phase?.globalRound {
                    Text("Round \(round) of \(IntervalEngine.totalRounds(session.interval?.plan ?? IntervalPlan(warmupSec: 0, sets: [], restBetweenSetsSec: 0, cooldownSec: 0)))")
                        .font(Theme.display(13, .bold, relativeTo: .footnote)).foregroundStyle(Theme.linen)
                }
                ZStack {
                    WedgeRing(phases: phases, index: at.index, progress: at.progress, lineWidth: 8)
                    VStack(spacing: 0) {
                        Text(phase?.label ?? "Ready")
                            .font(Theme.display(13, .extrabold, relativeTo: .caption)).foregroundStyle(fill)
                        Text(clockText(at.remaining, elapsed: elapsed))
                            .font(Theme.mono(44))
                            .foregroundStyle(startDate == nil ? Theme.linen : fill)
                    }
                }
                HStack {
                    if let bpm = workout.heartRate, !alwaysOn {
                        Text("\(bpm)")
                            .font(Theme.mono(16))
                            .foregroundStyle(Theme.linen)
                        Text("bpm").font(Theme.display(11, .bold, relativeTo: .caption2)).foregroundStyle(Theme.textMute)
                    }
                    Spacer()
                    if !alwaysOn {
                        Text(startDate == nil ? "tap to start" : "tap to pause")
                            .font(Theme.display(11, .regular, relativeTo: .caption2))
                            .foregroundStyle(Theme.textMute)
                    }
                }
            }
            .padding(.horizontal, 6)
            .dimmedWhenAlwaysOn(alwaysOn)
            .contentShape(Rectangle())
            .onTapGesture(perform: toggle)
            .onChange(of: at.index) { _, newIndex in
                handover(to: newIndex)
            }
            .onChange(of: at.done) { _, isDone in
                // The walk finished on its own. End the workout and show what happened — the
                // player never sits on a finished clock waiting to be dismissed.
                if isDone && startDate != nil {
                    workout.end()
                    startDate = nil
                    finished = true
                }
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
                startDate = nil
                finished = true
            }
            Text("Stopping early keeps the rounds you did.")
                .font(Theme.display(11, .regular, relativeTo: .caption2)).foregroundStyle(Theme.textMute)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 4)
    }

    private func controlButton(_ label: String, system: String, tint: Color,
                               action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: system)
                Text(label).font(Theme.display(11, .bold, relativeTo: .caption2))
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

    /**
     Send what happened, then leave.

     Rounds are the ones actually COMPLETED, from `roundsCompleted` — which is what makes the
     controls page's promise ("stopping early keeps the rounds you did") true in the record and
     not only on the screen. Before this the Done button did nothing at all.
     */
    private func submit(_ felt: FeltAnswer?, _ note: String) {
        let elapsed = currentElapsed(at: Date())
        var log = WatchSessionLog(
            occurrenceId: session.occurrenceId,
            finishedAt: ISO8601DateFormatter().string(from: Date()),
            kind: session.kind.rawValue
        )
        log.rounds = IntervalEngine.roundsCompleted(phases, elapsed: elapsed)
        log.elapsedSec = Int(elapsed)
        log.felt = felt?.rawValue
        log.note = note.isEmpty ? nil : note
        WatchLogSender.shared.send(log)
        dismiss()
    }

    private func handover(to index: Int) {
        guard startDate != nil, index != lastHapticIndex else { return }
        lastHapticIndex = index
        let kind = phases.indices.contains(index) ? phases[index].kind : .neutral
        WKInterfaceDevice.current().play(kind == .work ? .start : .stop)
    }
}
