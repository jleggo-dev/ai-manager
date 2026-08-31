import SwiftUI
import WatchKit

/**
 Face 03 — the strength timer, mid-set.

 Name and spec in mono, set dots (done sets filled sage), the elapsed clock, heart rate small in
 the corner, "up next", and **Set done**. Apple's engine runs underneath via `WorkoutController`,
 exactly as the interval player does — we draw the frame and count the sets while HealthKit
 measures and saves.

 Face 09 (the set-log) is one swipe away rather than a separate destination: "I did 5, not 6" has
 to be reachable DURING the set, not after the session, or it is not the honesty affordance it
 was designed to be.
 */
struct StrengthTimerView: View {
    let session: WatchSession

    @Environment(\.dismiss) private var dismiss
    @Environment(\.isLuminanceReduced) private var alwaysOn
    @EnvironmentObject private var workout: WorkoutController
    @State private var index = 0
    @State private var startDate = Date()
    @State private var records: [String: StrengthRecord] = [:]
    @State private var finished = false

    private var steps: [StrengthStep] { StrengthPlan.steps(for: session) }
    private var step: StrengthStep? { steps.indices.contains(index) ? steps[index] : nil }
    private var next: StrengthStep? { steps.indices.contains(index + 1) ? steps[index + 1] : nil }

    var body: some View {
        Group {
            if finished || step == nil {
                DoneView(session: session, facts: facts, onFinish: submit)
            } else if let step, step.isTimedHold {
                // Hands full: the hold runs itself, so there is no set-log page to swipe to —
                // offering the crown to someone hanging off a bar is offering nothing.
                HoldView(exercise: step.exercise, setLine: step.setLine) {
                    logAsPrescribed()
                }
            } else if let step {
                TabView {
                    timerFace
                    SetLogView(step: step, record: binding(for: step), onLogged: advance)
                }
                .tabViewStyle(.page)
            }
        }
        .navigationTitle(session.title)
        .navigationBarBackButtonHidden(!finished)
        .onAppear {
            workout.requestAuthorization()
            workout.begin(occurrenceId: session.occurrenceId, activity: .traditionalStrengthTraining)
        }
        .onDisappear { workout.end() }
        .background(Color.black)
    }

    private var timerFace: some View {
        VStack(spacing: 4) {
            if let step {
                Text(step.exercise.name)
                    .font(Theme.display(13, .bold, relativeTo: .caption))
                    .foregroundStyle(Theme.linen)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)

                Text(step.exercise.spec)
                    .font(Theme.mono(11, relativeTo: .caption2))
                    .foregroundStyle(Theme.textMute)

                SetDots(total: step.totalSets, done: step.setNumber - 1)
                    .padding(.vertical, 2)

                TimelineView(.periodic(from: .now, by: 1)) { timeline in
                    Text(elapsedText(at: timeline.date))
                        .font(Theme.mono(34))
                        .foregroundStyle(Theme.linen)
                }

                Button {
                    logAsPrescribed()
                } label: {
                    Text("Set done")
                        .font(Theme.display(13, .bold, relativeTo: .caption))
                        .foregroundStyle(Theme.forest)
                        .frame(maxWidth: .infinity)
                }
                .tint(Theme.sage)
                .buttonStyle(.borderedProminent)

                HStack {
                    if let bpm = workout.heartRate, !alwaysOn {
                        Text("\(bpm)")
                            .font(Theme.mono(11, relativeTo: .caption2))
                            .foregroundStyle(Theme.linen)
                        Text("bpm").font(Theme.display(11, .regular, relativeTo: .caption2)).foregroundStyle(Theme.textMute)
                    }
                    Spacer()
                    if let next {
                        Text("up next — \(next.exercise.name)")
                            .font(Theme.display(11, .regular, relativeTo: .caption2))
                            .foregroundStyle(Theme.textDim)
                            .lineLimit(1)
                    }
                }
            }
        }
        .padding(.horizontal, 6)
    }

    // MARK: - Progress

    private func binding(for step: StrengthStep) -> Binding<StrengthRecord> {
        Binding(
            get: {
                records[step.id] ?? StrengthRecord(
                    stepId: step.id,
                    name: step.exercise.name,
                    plannedReps: step.exercise.reps,
                    actualReps: step.exercise.reps,
                    done: false
                )
            },
            set: { records[step.id] = $0 }
        )
    }

    /** The ordinary path: it went as prescribed. The crown page exists for when it did not. */
    private func logAsPrescribed() {
        guard let step else { return }
        var record = binding(for: step).wrappedValue
        record.done = true
        records[step.id] = record
        advance()
    }

    private func advance() {
        WKInterfaceDevice.current().play(.success)
        if index + 1 < steps.count {
            index += 1
        } else {
            finished = true
            workout.end()
        }
    }

    private func elapsedText(at date: Date) -> String {
        return String(format: "%d:%02d", elapsedSeconds / 60, elapsedSeconds % 60)
    }

    private var elapsedSeconds: Int {
        max(0, Int(Date().timeIntervalSince(startDate)))
    }

    /**
     Send what happened, then leave.

     Only steps actually walked are reported, and each carries the reps that were LOGGED alongside
     the reps that were asked — so an amendment stays legible as one all the way to the plan.
     */
    private func submit(_ felt: FeltAnswer?, _ note: String) {
        var log = WatchSessionLog(
            occurrenceId: session.occurrenceId,
            finishedAt: ISO8601DateFormatter().string(from: Date()),
            kind: session.kind.rawValue
        )
        log.items = steps.compactMap { step in
            guard let record = records[step.id], record.done else { return nil }
            return WatchLogItem(
                name: record.name,
                done: true,
                sets: 1,
                reps: record.actualReps,
                plannedReps: record.plannedReps
            )
        }
        log.felt = felt?.rawValue
        log.note = note.isEmpty ? nil : note
        log.elapsedSec = elapsedSeconds
        WatchLogSender.shared.send(log)
        dismiss()
    }

    /**
     The three facts the Done face shows.

     Sets DONE, never sets missed — and the amended count is named as its own fact rather than
     hidden, because "I did 5, not 6" is information the plan wants, not a shortfall to bury.
     */
    private var facts: [DoneFact] {
        let done = records.values.filter(\.done).count
        let amended = records.values.filter { $0.done && $0.amended }.count
        var out: [DoneFact] = [
            DoneFact(label: "sets", value: "\(done)"),
            DoneFact(label: "elapsed", value: elapsedText(at: Date())),
        ]
        if let bpm = workout.averageHeartRate {
            out.append(DoneFact(label: "avg bpm", value: "\(bpm)"))
        } else if amended > 0 {
            out.append(DoneFact(label: "amended", value: "\(amended)"))
        }
        return out
    }
}

/** Set dots — done sets filled sage, the rest ghosted. The row IS the count, so no caption. */
struct SetDots: View {
    let total: Int
    let done: Int

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<max(1, total), id: \.self) { i in
                Circle()
                    .fill(i < done ? Theme.sage : Theme.line.opacity(0.28))
                    .frame(width: 7, height: 7)
            }
        }
        .accessibilityLabel("\(done) of \(total) sets done")
    }
}
