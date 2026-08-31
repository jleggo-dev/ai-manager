import SwiftUI
import WorkoutKit

/**
 The alternative: run this in Apple's Workout app instead of ours.

 Until native tracking landed this was the ONLY thing a run could do. Now it is a choice, reached
 from the tracked session's controls page — some people want Apple's running UI, and
 `openInWorkoutApp()` is watchOS-only, which is exactly why the wrist can offer both.

 The composed workout arrives in the payload — `composeWorkoutPlan` on the phone decided what it
 is, and `WorkoutSpec.swift` decodes it. When no plan composed, this face says so plainly rather
 than drawing a button that fails: the return needs no design either way, because a finished run
 comes back through the ordinary HealthKit read-back carrying our occurrence id.
 */
struct HandoffView: View {
    let session: WatchSession

    @State private var opening = false
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                CoachPortrait(size: 40)

                Text("I've set this up in Apple's Workout app — it takes it from here.")
                    .font(Theme.display(13, .regular, relativeTo: .footnote))
                    .foregroundStyle(Theme.linen)
                    .multilineTextAlignment(.center)

                VStack(spacing: 2) {
                    Text(session.title)
                        .font(Theme.display(13, .bold, relativeTo: .caption))
                        .foregroundStyle(Theme.linen)
                    Text(session.subtitle)
                        .font(Theme.display(12, .regular, relativeTo: .caption2))
                        .foregroundStyle(Theme.textMute)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))

                action
            }
            .padding(.horizontal, 6)
        }
        .navigationTitle("Use Workout")
        .background(Color.black)
    }

    @ViewBuilder
    private var action: some View {
        if #available(watchOS 10.0, *), let plan = session.workout?.plan {
            Button {
                open(plan)
            } label: {
                Label("Open Workout", systemImage: "arrow.up.right")
                    .font(Theme.display(13, .bold, relativeTo: .caption))
                    .frame(maxWidth: .infinity)
            }
            .tint(Theme.sun)
            .buttonStyle(.borderedProminent)
            .disabled(opening)

            if failed {
                // Apple refused to open it. An honest sentence beats a spinner that never ends.
                Text("Workout didn't open. You can start it there yourself.")
                    .font(Theme.display(11, .regular, relativeTo: .caption2))
                    .foregroundStyle(Theme.textMute)
                    .multilineTextAlignment(.center)
            }
        } else {
            // No composed plan (or watchOS 9): the row still told the truth about what today
            // holds; it simply cannot open it from here.
            Text("Start this one in the Workout app.")
                .font(Theme.display(11, .regular, relativeTo: .caption2))
                .foregroundStyle(Theme.textMute)
                .multilineTextAlignment(.center)
        }
    }

    @available(watchOS 10.0, *)
    private func open(_ plan: WorkoutPlan) {
        opening = true
        failed = false
        Task {
            do {
                try await plan.openInWorkoutApp()
            } catch {
                failed = true
            }
            opening = false
        }
    }
}
