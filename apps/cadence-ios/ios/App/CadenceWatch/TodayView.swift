import SwiftUI

/** Face 01 — Today: the coach's presence, then today's sessions. A run row hands off to
 *  Apple's Workout app (W2: openInWorkoutApp; W1 marks the intent). Rest day is its own
 *  quiet state — never "no workouts scheduled". */
struct TodayView: View {
    let sessions = SampleWeek.today

    var body: some View {
        List {
            if sessions.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "moon")
                        .foregroundStyle(Theme.duskLifted)
                    Text("Today's clear.")
                        .font(.headline).foregroundStyle(Theme.linen)
                    Text("Rest is part of the rhythm.")
                        .font(.footnote).foregroundStyle(Theme.textMute)
                }
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            } else {
                ForEach(sessions) { session in
                    NavigationLink(value: session.id) {
                        row(session)
                    }
                    .listRowBackground(
                        RoundedRectangle(cornerRadius: 12).fill(Theme.card)
                    )
                }
            }
        }
        .navigationDestination(for: UUID.self) { id in
            if let session = sessions.first(where: { $0.id == id }) {
                destination(session)
            }
        }
        .navigationTitle(weekday)
        .background(Color.black)
    }

    @ViewBuilder
    private func destination(_ session: WatchSession) -> some View {
        switch session.kind {
        case .interval: IntervalPlayerView(session: session)
        case .strength: SessionDetailView(session: session)
        case .run: HandoffView(session: session)
        case .sit: SessionDetailView(session: session)
        }
    }

    private func row(_ session: WatchSession) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title).font(.body.weight(.semibold)).foregroundStyle(Theme.linen)
                Text(session.subtitle).font(.caption2).foregroundStyle(Theme.textMute)
            }
            Spacer()
            Image(systemName: session.kind == .run ? "arrow.up.right" : "play.circle")
                .foregroundStyle(session.kind == .run ? Theme.sun : Theme.sage)
        }
        .padding(.vertical, 2)
    }

    private var weekday: String {
        Date().formatted(.dateTime.weekday(.wide))
    }
}

/** Face 13 — the hand-off moment: she speaks once, Workout takes it from here. */
struct HandoffView: View {
    let session: WatchSession
    var body: some View {
        VStack(spacing: 10) {
            Text("Off you go")
                .font(.headline).foregroundStyle(Theme.linen)
            Text("I've set up your run — Workout takes it from here.")
                .font(.footnote).foregroundStyle(Theme.textMute)
                .multilineTextAlignment(.center)
            Text("opens automatically")
                .font(.caption2).foregroundStyle(Theme.textDim)
        }
        .padding()
        .background(Color.black)
        // W2: WorkoutPlan.openInWorkoutApp() with the composed plan, id = occurrence id.
    }
}
