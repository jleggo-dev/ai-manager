import SwiftUI

/**
 Face 09 — the set-log: "I did 5, not 6".

 The crown turns the number; the planned figure stays as a whisper beside it, never overwritten
 and never scolding. The button logs REALITY — its label says the number it is about to record,
 so nobody has to trust that the dial and the button agree.

 This is one of the phone's honesty affordances in its watch-native form. Its whole reason to
 exist is that a prescription is a guess: the plan gets better when it learns what actually
 happened, and it can only learn that if amending is easier than lying.
 */
struct SetLogView: View {
    let step: StrengthStep
    @Binding var record: StrengthRecord
    let onLogged: () -> Void

    /** Crown-bound reps. Seeded from the prescription so the common case is one tap. */
    @State private var reps: Double = 0

    private var planned: Int? { step.exercise.reps }
    private var current: Int { max(0, Int(reps.rounded())) }

    var body: some View {
        VStack(spacing: 6) {
            Text(step.exercise.name)
                .font(Theme.display(12, .bold, relativeTo: .caption2))
                .foregroundStyle(Theme.textMute)
                .lineLimit(1)

            Text("\(current)")
                .font(Theme.mono(48))
                .foregroundStyle(Theme.linen)
                .focusable()
                .digitalCrownRotation(
                    $reps,
                    from: 0,
                    through: 99,
                    by: 1,
                    sensitivity: .low,
                    isContinuous: false,
                    isHapticFeedbackEnabled: true
                )

            if let planned {
                // A whisper, not a verdict. The prescription stays visible so the amendment is a
                // comparison the user makes, never a correction the app announces.
                Text("planned \(planned)")
                    .font(Theme.display(12, .regular, relativeTo: .caption2))
                    .foregroundStyle(Theme.textDim)
            }

            Button {
                record.actualReps = current
                record.done = true
                onLogged()
            } label: {
                Text("Log \(current)")
                    .font(Theme.display(13, .bold, relativeTo: .caption))
                    .foregroundStyle(Theme.forest)
                    .frame(maxWidth: .infinity)
            }
            .tint(Theme.sage)
            .buttonStyle(.borderedProminent)
        }
        .padding(.horizontal, 8)
        .onAppear {
            reps = Double(record.actualReps ?? planned ?? 0)
        }
    }
}
