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
        .toolbar {
            // Her presence, per the settled brief: the portrait anchors the header; the mark
            // stays the app icon. W1 bundles a stand-in portrait — the user's CHOSEN face
            // arrives with the WatchConnectivity sync, not a new surface.
            ToolbarItem(placement: .topBarLeading) { CoachPortrait() }
        }
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

/** The coach's portrait, from the bundled stand-in (synced choice comes with W2). A missing
 *  file degrades to the sage circle — never a broken image on a wrist. */
struct CoachPortrait: View {
    var body: some View {
        Group {
            if let path = Bundle.main.path(forResource: "coach", ofType: "jpg"),
               let image = UIImage(contentsOfFile: path) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Circle().fill(Theme.sage)
            }
        }
        .frame(width: 24, height: 24)
        .clipShape(Circle())
        .accessibilityLabel("Your coach")
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
