import SwiftUI
import HealthKit
import WatchKit

/**
 The tracked session — a run, a ride, a swim, a row, in our own frame.

 This is what the watch app deliberately did not do until now: outdoor work handed off to Apple's
 Workout app, on a ruling that turned out to be the assistant's caution rather than an owner
 preference. With that lifted, the session runs here — and Apple's app stays one tap away for
 anyone who prefers it, which is a choice rather than a dead end.

 **Apple's engine is still underneath.** `HKWorkoutSession` + `HKLiveWorkoutBuilder` run the
 sensors, the GPS duty cycle, the calorimetry, the background runtime and the save to Health. What
 is ours is the frame: the numbers that matter, in our type, in our colours, and a session that
 ends on the same Done face as everything else. The only genuinely new code is the route line
 (`RouteRecorder`), because that is the one thing HealthKit does not collect on its own.

 The four numbers were chosen for a glanced-at screen, not a dashboard: elapsed and distance big,
 pace and heart rate small. Nothing here is a target, a zone, or a comparison to last time.
 */
struct TrackedSessionView: View {
    let session: WatchSession

    @Environment(\.dismiss) private var dismiss
    /** Always-On: the wrist is down. See `AlwaysOn.swift` — HR comes off, seconds come off. */
    @Environment(\.isLuminanceReduced) private var alwaysOn
    @EnvironmentObject private var workout: WorkoutController
    @State private var startDate: Date?
    @State private var finished = false
    @State private var showAppleOption = false

    /**
     The activity, decided on the phone and carried on the session itself.

     Read from `session.activity`, NOT from the composed WorkoutKit spec — that spec exists only
     when the prescription composed, and an "Evening run" with no prescription would otherwise
     track as `.other` with no route: a run filed in Health as an unnamed workout.
     */
    private var activity: HKWorkoutActivityType {
        HKWorkoutActivityType.fromCadenceName(session.activity)
    }

    private var location: HKWorkoutSessionLocationType {
        HKWorkoutSessionLocationType.fromCadenceName(session.location)
    }

    /** Record a route only when the work actually happens over ground. An indoor row or a
     *  treadmill run has no line to draw, and asking for location there would be taking a
     *  permission we have no use for. */
    private var wantsRoute: Bool { location == .outdoor }

    var body: some View {
        Group {
            if finished {
                DoneView(session: session, facts: facts, onFinish: submit)
            } else {
                TabView {
                    liveFace
                    controlsFace
                }
                .tabViewStyle(.page)
            }
        }
        .navigationTitle(session.title)
        .navigationBarBackButtonHidden(startDate != nil && !finished)
        .onAppear { workout.requestAuthorization() }
        .onDisappear { if !finished { workout.end() } }
        .background(Color.black)
    }

    private var liveFace: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let elapsed = elapsedSeconds(at: timeline.date)
            VStack(spacing: 2) {
                Text(sessionClock(elapsed, alwaysOn: alwaysOn))
                    .font(Theme.mono(alwaysOn ? 30 : 38))
                    .foregroundStyle(startDate == nil ? Theme.textMute : Theme.linen)

                if let km = workout.distanceKm {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(String(format: "%.2f", km)).font(Theme.mono(26))
                            .foregroundStyle(Theme.linen)
                        Text("km").font(Theme.display(12, .bold, relativeTo: .caption2))
                            .foregroundStyle(Theme.textMute)
                    }
                }

                // Heart rate is absent on the dimmed face by design: once a minute, unwatched, it
                // reads as current and is not.
                if !alwaysOn {
                    HStack(spacing: 10) {
                        if let pace = paceLine(km: workout.distanceKm, seconds: elapsed) {
                            stat(pace, "/km")
                        }
                        if let bpm = workout.heartRate {
                            stat("\(bpm)", "bpm")
                        }
                    }
                    .padding(.top, 2)
                }

                Spacer(minLength: 0)

                if !alwaysOn {
                    Text(startDate == nil ? "tap to start" : "tap to pause")
                        .font(Theme.display(11, .regular, relativeTo: .caption2))
                        .foregroundStyle(Theme.textDim)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 6)
            .dimmedWhenAlwaysOn(alwaysOn)
            .contentShape(Rectangle())
            .onTapGesture(perform: toggle)
        }
    }

    private func stat(_ value: String, _ unit: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 2) {
            Text(value).font(Theme.mono(14))
                .foregroundStyle(Theme.linen)
            Text(unit).font(Theme.display(10, .regular, relativeTo: .caption2))
                .foregroundStyle(Theme.textMute)
        }
    }

    private var controlsFace: some View {
        VStack(spacing: 8) {
            Button {
                toggle()
            } label: {
                Label(startDate == nil ? "Resume" : "Pause",
                      systemImage: startDate == nil ? "play.fill" : "pause.fill")
                    .font(Theme.display(12, .bold, relativeTo: .caption2))
                    .frame(maxWidth: .infinity)
            }
            .tint(Theme.linen)
            .buttonStyle(.bordered)

            Button {
                workout.end()
                startDate = nil
                finished = true
            } label: {
                Label("End", systemImage: "stop.fill")
                    .font(Theme.display(12, .bold, relativeTo: .caption2))
                    .frame(maxWidth: .infinity)
            }
            .tint(Theme.sun)
            .buttonStyle(.bordered)

            // Apple's app as an ALTERNATIVE, not the destination. Only offered before starting —
            // switching mid-session would abandon a measured effort with no way to reconcile it.
            if startDate == nil, session.workout != nil {
                Button("Use Apple's Workout app") { showAppleOption = true }
                    .font(Theme.display(11, .regular, relativeTo: .caption2))
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.textMute)
            }

            Text("Stopping early keeps the distance you covered.")
                .font(Theme.display(10, .regular, relativeTo: .caption2))
                .foregroundStyle(Theme.textDim)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 4)
        .navigationDestination(isPresented: $showAppleOption) {
            HandoffView(session: session)
        }
    }

    // MARK: - Clock and pace

    private func elapsedSeconds(at date: Date) -> Int {
        guard let startDate else { return pausedElapsed }
        return pausedElapsed + Int(date.timeIntervalSince(startDate))
    }

    @State private var pausedElapsed = 0

    private func clock(_ seconds: Int) -> String {
        seconds >= 3600
            ? String(format: "%d:%02d:%02d", seconds / 3600, (seconds % 3600) / 60, seconds % 60)
            : String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    /**
     Average pace so far, as `m:ss`.

     Deliberately the session average rather than an instant pace: a rolling instant figure on a
     wrist jitters with every GPS fix, and a number that will not sit still is not information.
     Absent until there is enough distance to divide by — a pace computed over ten metres is
     noise wearing a unit.
     */
    private func paceLine(km: Double?, seconds: Int) -> String? {
        guard let km, km >= 0.05, seconds > 0 else { return nil }
        let secondsPerKm = Int(Double(seconds) / km)
        guard secondsPerKm < 3600 else { return nil }
        return String(format: "%d:%02d", secondsPerKm / 60, secondsPerKm % 60)
    }

    private func toggle() {
        if let started = startDate {
            pausedElapsed += Int(Date().timeIntervalSince(started))
            startDate = nil
        } else {
            if pausedElapsed == 0 {
                workout.begin(
                    occurrenceId: session.occurrenceId,
                    activity: activity,
                    location: location,
                    recordRoute: wantsRoute
                )
            }
            startDate = Date()
        }
        WKInterfaceDevice.current().play(.click)
    }

    /** What happened — measured, never compared. */
    private var facts: [DoneFact] {
        var out: [DoneFact] = []
        if let km = workout.distanceKm {
            out.append(DoneFact(label: "km", value: String(format: "%.2f", km)))
        }
        out.append(DoneFact(label: "time", value: clock(elapsedSeconds(at: Date()))))
        if let bpm = workout.averageHeartRate {
            out.append(DoneFact(label: "avg bpm", value: "\(bpm)"))
        } else if let kcal = workout.energyKcal {
            out.append(DoneFact(label: "kcal", value: "\(kcal)"))
        }
        return out
    }

    private func submit(_ felt: FeltAnswer?, _ note: String) {
        var log = WatchSessionLog(
            occurrenceId: session.occurrenceId,
            finishedAt: ISO8601DateFormatter().string(from: Date()),
            kind: session.kind.rawValue
        )
        log.elapsedSec = elapsedSeconds(at: Date())
        log.distanceKm = workout.distanceKm
        log.energyKcal = workout.energyKcal
        log.felt = felt?.rawValue
        log.note = note.isEmpty ? nil : note
        WatchLogSender.shared.send(log)
        dismiss()
    }
}
