import SwiftUI

/**
 Face 05 — Done.

 One warm line, three facts, the felt question, the mic, "Saved to Health" as a whisper, one exit.

 **No score, no comparison, no confetti.** The rings closing are Apple's moment and we do not
 compete with it; what this face adds is the one thing Apple cannot ask — how it FELT — because
 that is what next week's plan is actually shaped from. Easy / Right / Hard is the same three-way
 the phone asks after a session, in the same words.

 The mic is dictation into the same words-to-log path the phone uses: "I did more/less/different"
 belongs here, on the wrist, while it is still true. On watchOS a `TextField` opens the system
 input controller, which offers dictation and scribble — so this is Apple's own text entry rather
 than a recorder of our own.
 */
struct DoneFact: Identifiable, Hashable {
    let label: String
    let value: String
    var id: String { label }
}

enum FeltAnswer: String, CaseIterable, Identifiable {
    case easy, right, hard
    var id: String { rawValue }

    /** Their words, not a rating. "Right" is deliberately not "good" — a session can be right and
     *  still have been hard, and the plan wants the difference. */
    var label: String {
        switch self {
        case .easy: return "Easy"
        case .right: return "Right"
        case .hard: return "Hard"
        }
    }
}

struct DoneView: View {
    let session: WatchSession
    let facts: [DoneFact]
    /**
     Hand what the user said back to the caller, which owns building and sending the log.

     The felt answer and the dictated note are the two things only this face collects, and until
     W2's return leg they were collected and dropped — the question was asked and the answer went
     nowhere. The caller sends because only it knows what else happened (rounds walked, sets done).
     */
    let onFinish: (FeltAnswer?, String) -> Void

    @State private var felt: FeltAnswer?
    @State private var note = ""
    @State private var sent = false

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text("That's done.")
                    .font(Theme.display(17, .bold, relativeTo: .headline))
                    .foregroundStyle(Theme.linen)

                factRow

                feltQuestion

                // The mic row. watchOS gives dictation through the system input controller behind
                // a TextField — no recording of our own, no permission of our own.
                TextField("I did more, less, different…", text: $note, axis: .vertical)
                    .font(Theme.display(12, .regular, relativeTo: .caption2))
                    .foregroundStyle(Theme.linen)
                    .lineLimit(1...3)

                Text(sent ? "Saved" : "Saved to Health")
                    .font(Theme.display(11, .regular, relativeTo: .caption2))
                    .foregroundStyle(Theme.textDim)

                Button {
                    guard !sent else { return }
                    sent = true
                    onFinish(felt, note.trimmingCharacters(in: .whitespacesAndNewlines))
                } label: {
                    Text("Done")
                        .font(Theme.display(13, .bold, relativeTo: .caption))
                        .foregroundStyle(Theme.forest)
                        .frame(maxWidth: .infinity)
                }
                .tint(Theme.sage)
                .buttonStyle(.borderedProminent)
                .disabled(sent)
            }
            .padding(.horizontal, 6)
        }
        .navigationTitle(session.title)
        .background(Color.black)
    }

    /** Three facts, in mono. What happened — never a comparison to last time, never a target. */
    private var factRow: some View {
        HStack(spacing: 10) {
            ForEach(facts) { fact in
                VStack(spacing: 1) {
                    Text(fact.value)
                        .font(Theme.mono(13))
                        .foregroundStyle(Theme.linen)
                    Text(fact.label)
                        .font(Theme.display(11, .regular, relativeTo: .caption2))
                        .foregroundStyle(Theme.textDim)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
    }

    private var feltQuestion: some View {
        VStack(spacing: 4) {
            Text("How did that feel?")
                .font(Theme.display(11, .regular, relativeTo: .caption2))
                .foregroundStyle(Theme.textMute)
            HStack(spacing: 4) {
                ForEach(FeltAnswer.allCases) { answer in
                    Button {
                        felt = answer
                    } label: {
                        Text(answer.label)
                            .font(Theme.display(12, .bold, relativeTo: .caption2))
                            .frame(maxWidth: .infinity)
                    }
                    .tint(felt == answer ? Theme.sage : Theme.textMute)
                    .buttonStyle(.bordered)
                }
            }
        }
    }
}
