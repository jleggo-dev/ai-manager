import SwiftUI

/**
 Face 01 — Today: the coach's presence, then today's sessions.

 A run row hands off to Apple's Workout app; everything else opens the face its `kind` names.
 Rest day is its own quiet state — never "no workouts scheduled".

 The week now comes from `WatchStore` (W2). A session the phone did not send detail for still
 shows as a row and says what it is, but cannot be started: `detailed == false` is the phone
 telling the wrist "this one is not yours to run yet", and a dead player is the one thing a wrist
 must never offer.
 */
struct TodayView: View {
    @EnvironmentObject private var store: WatchStore
    @EnvironmentObject private var workout: WorkoutController

    /** A session recovered after a kill, pushed back onto the stack. */
    @State private var resumed: String?

    private var today: WatchDay? { store.week.today }
    private var sessions: [WatchSession] { today?.sessions ?? [] }

    var body: some View {
        List {
            if sessions.isEmpty {
                RestDayCard(nextUp: nextUpLine)
            } else {
                ForEach(sessions) { session in
                    NavigationLink(value: session.occurrenceId) {
                        SessionRow(session: session)
                    }
                    .listRowBackground(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
                }
            }

            NavigationLink(value: WatchRoute.week) {
                Label("Your week", systemImage: "calendar")
                    .font(Theme.display(13, .bold, relativeTo: .caption))
                    .foregroundStyle(Theme.textMute)
            }
            .listRowBackground(Color.clear)
        }
        .navigationDestination(for: String.self) { id in
            if let session = sessions.first(where: { $0.occurrenceId == id }) {
                SessionDestination(session: session)
            }
        }
        .navigationDestination(for: WatchRoute.self) { route in
            switch route {
            case .week: WeekView()
            }
        }
        /**
         Reopen a session the system kept running while this app was killed.

         Pushing straight back into its face is the whole point: the workout never stopped, so the
         alternative is a Today screen that looks idle while HealthKit quietly records. Matched by
         the occurrence id stamped on the builder at START.
         */
        .onChange(of: workout.recoveredOccurrenceId) { _, id in
            guard let id, sessions.contains(where: { $0.occurrenceId == id }) else { return }
            resumed = id
            workout.clearRecoveryFlag()
        }
        .navigationDestination(item: $resumed) { id in
            if let session = sessions.first(where: { $0.occurrenceId == id }) {
                SessionDestination(session: session)
            }
        }
        .navigationTitle(today?.weekday ?? "Today")
        .toolbar {
            // Her presence, per the settled brief: the portrait anchors the header; the mark
            // stays the app icon.
            ToolbarItem(placement: .topBarLeading) { CoachPortrait() }
        }
        .background(Color.black)
    }

    /** The rest-day board's one line about tomorrow — real if the week carries it, absent if not.
     *  Never invented: a promise about tomorrow that turns out wrong is worse than silence. */
    private var nextUpLine: String? {
        guard let todayDate = today?.date,
              let next = store.week.days.first(where: { $0.date > todayDate && !$0.sessions.isEmpty }),
              let first = next.sessions.first else { return nil }
        return "\(next.weekday): \(first.title)"
    }
}

/** The routes Today can push that are not a session. */
enum WatchRoute: Hashable {
    case week
}

/** Which face opens a session — the `kind` the phone decided, never re-derived here. */
struct SessionDestination: View {
    let session: WatchSession

    var body: some View {
        switch session.kind {
        case .interval: IntervalPlayerView(session: session)
        case .strength: SessionDetailView(session: session)
        case .sit: SitView(session: session)
        case .tracked: TrackedSessionView(session: session)
        }
    }
}

/** One session, as a row. Done sessions keep their place and wear their outcome — the week counts
 *  what happened, and a finished thing disappearing would be counting what is left. */
struct SessionRow: View {
    let session: WatchSession

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(session.title)
                    .font(Theme.display(16, .semibold, relativeTo: .body))
                    .foregroundStyle(session.isDone ? Theme.textMute : Theme.linen)
                Text(session.subtitle)
                    .font(Theme.display(12, .regular, relativeTo: .caption2))
                    .foregroundStyle(session.isDone ? Theme.sage : Theme.textMute)
            }
            Spacer()
            trailingGlyph
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private var trailingGlyph: some View {
        if session.isDone {
            Image(systemName: "checkmark").foregroundStyle(Theme.sage)
        } else if !session.detailed {
            // Honest about what it cannot do: this row is a plan, not a player.
            Image(systemName: "iphone").foregroundStyle(Theme.textDim)
        } else if session.kind == .tracked {
            // Its own glyph: this is a measured effort, not a scripted one. It used to be the
            // hand-off arrow, which said "you are leaving" — you are not, any more.
            Image(systemName: "location.fill").foregroundStyle(Theme.sage)
        } else {
            Image(systemName: "play.circle").foregroundStyle(Theme.sage)
        }
    }
}

/** Face 12 — rest day. Its own board, never an empty state. */
struct RestDayCard: View {
    let nextUp: String?

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: "moon").foregroundStyle(Theme.duskLifted)
            Text("Today's clear.")
                .font(Theme.display(17, .bold, relativeTo: .headline)).foregroundStyle(Theme.linen)
            Text("Rest is part of the rhythm.")
                .font(Theme.display(13, .regular, relativeTo: .footnote)).foregroundStyle(Theme.textMute)
                .multilineTextAlignment(.center)
            if let nextUp {
                Text(nextUp)
                    .font(Theme.display(12, .regular, relativeTo: .caption2)).foregroundStyle(Theme.textDim)
                    .multilineTextAlignment(.center)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .listRowBackground(Color.clear)
    }
}

/**
 The coach's portrait.

 Three sources, in order: the face the user CHOSE (synced from the phone as a file), the bundled
 stand-in, then a sage circle. The middle one matters — a stand-in is a real picture of a coach, so
 a watch that has not synced yet shows a different face rather than a broken one. The synced choice
 replacing it is the whole point: the portrait belongs to the user, not to us.
 */
struct CoachPortrait: View {
    @EnvironmentObject private var store: WatchStore
    var size: CGFloat = 24

    var body: some View {
        Group {
            if let image = portrait {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Circle().fill(Theme.sage)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .accessibilityLabel("Your coach")
    }

    private var portrait: UIImage? {
        if let url = store.portraitURL, let chosen = UIImage(contentsOfFile: url.path) {
            return chosen
        }
        guard let path = Bundle.main.path(forResource: "coach", ofType: "jpg") else { return nil }
        return UIImage(contentsOfFile: path)
    }
}
