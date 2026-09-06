import SwiftUI

/**
 Face 07 — your week: the whole plan, seven day rows with trail-style segmented rings.

 **Counts what happened, never what is left.** The footer says "showed up 2 of 2 so far" — a
 count of the sessions that HAPPENED against the ones that have come due, which is why a week
 half-lived reads as a full one rather than a deficit. Nothing here resets, nothing is red, and a
 missed day is quiet rather than marked.

 Only reachable because the sync carries the whole week (W2). Before it, this face had nothing to
 draw.
 */
struct WeekView: View {
    @EnvironmentObject private var store: WatchStore

    var body: some View {
        List {
            ForEach(store.week.days) { day in
                DayRow(day: day, isToday: store.isToday(day))
                    .listRowBackground(
                        store.isToday(day)
                            ? RoundedRectangle(cornerRadius: 12).fill(Theme.card)
                            : RoundedRectangle(cornerRadius: 12).fill(Color.clear)
                    )
            }

            Section {
                Text(showedUpLine)
                    .font(Theme.display(12, .regular, relativeTo: .caption2))
                    .foregroundStyle(Theme.textMute)
                    .frame(maxWidth: .infinity)
                if store.isSample {
                    // Never let sample data pass for a plan. On a wrist there is no other way to
                    // tell, and a fake week quietly presented as real is the worst failure here.
                    Text("Not synced yet — open Cadence on your phone.")
                        .font(Theme.display(11, .regular, relativeTo: .caption2))
                        .foregroundStyle(Theme.textDim)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
            }
            .listRowBackground(Color.clear)
        }
        .navigationTitle("Your week")
        .background(Color.black)
    }

    /**
     "showed up 2 of 2 so far" — the denominator is what has come DUE, not what the week holds.

     Counting against the whole week would turn Tuesday into "2 of 9", which is a scoreboard
     telling someone they are behind on work they were never yet asked to do.
     */
    private var showedUpLine: String {
        // Due = on or before the clock's date. A held week that has fallen behind the clock is
        // all due, which is what "so far" means once the week is over.
        let todayDate = store.todayISO
        let due = store.week.days.filter { $0.date <= todayDate }
        let sessions = due.flatMap(\.sessions)
        let done = sessions.filter(\.isDone).count
        guard !sessions.isEmpty else { return "Your week is clear so far." }
        return "showed up \(done) of \(sessions.count) so far"
    }
}

/** One day: its name, its ring, and what is on it. */
struct DayRow: View {
    let day: WatchDay
    /** Decided by the store's clock, not the payload's flag — see `WatchStore.todayISO`. */
    let isToday: Bool

    var body: some View {
        HStack(spacing: 10) {
            DayRing(day: day)
                .frame(width: 26, height: 26)

            VStack(alignment: .leading, spacing: 2) {
                Text(day.weekday)
                    .font(Theme.display(13, isToday ? .bold : .semibold, relativeTo: .caption))
                    .foregroundStyle(isToday ? Theme.linen : Theme.textMute)
                Text(summary)
                    .font(Theme.display(11, .regular, relativeTo: .caption2))
                    .foregroundStyle(Theme.textDim)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.vertical, 2)
    }

    /** The day's own words — the sessions' titles, never a category label. */
    private var summary: String {
        if day.sessions.isEmpty { return "Rest" }
        return day.sessions.map(\.title).joined(separator: " · ")
    }
}

/**
 The day's segmented ring — one wedge per session, done wedges in sage.

 The same grammar as the interval player's ring and the phone's trail: the shape IS the day's
 shape. A rest day draws a quiet dusk circle rather than an empty one, because nothing scheduled
 is a decision the plan made, not an absence.
 */
struct DayRing: View {
    let day: WatchDay

    private let lineWidth: CGFloat = 3
    private let gap = 0.04

    var body: some View {
        Canvas { context, size in
            let r = min(size.width, size.height) / 2 - lineWidth / 2
            let center = CGPoint(x: size.width / 2, y: size.height / 2)

            guard !day.sessions.isEmpty else {
                stroke(context, center: center, r: r, from: .degrees(-90), span: 360,
                       color: Theme.dusk.opacity(0.5))
                return
            }

            let span = 1.0 / Double(day.sessions.count)
            for (i, session) in day.sessions.enumerated() {
                let start = Angle(degrees: Double(i) * span * 360 - 90)
                let arc = max(0.02, span - gap) * 360
                stroke(context, center: center, r: r, from: start, span: arc,
                       color: session.isDone ? Theme.sage : Theme.line.opacity(0.28))
            }
        }
    }

    private func stroke(_ context: GraphicsContext, center: CGPoint, r: CGFloat,
                        from: Angle, span: Double, color: Color) {
        var path = Path()
        path.addArc(center: center, radius: r, startAngle: from,
                    endAngle: from + Angle(degrees: span), clockwise: false)
        context.stroke(path, with: .color(color),
                       style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
    }
}
