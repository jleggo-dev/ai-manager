import SwiftUI

/**
 Face 08 — the prescription before starting: blocks, sets × reps @ load in mono, Start beside
 Less time (the phone's condense).

 A session the phone did not send detail for lands here too, and says so rather than offering a
 Start that would open an empty timer. That is the wrist's version of the standing rule: a dead
 affordance is worse than none, and worse here than anywhere.
 */
struct SessionDetailView: View {
    let session: WatchSession

    @State private var condensed = false

    /** "Less time" — the phone's condense, in the one form a wrist can honour without a coach
     *  round trip: the main work only. Nothing is invented and nothing is reordered; the warm-up
     *  and the finisher are simply not walked. */
    private var blocks: [WatchBlock] {
        guard condensed else { return session.blocks }
        let main = session.blocks.filter { $0.label.lowercased().contains("main") }
        return main.isEmpty ? session.blocks : main
    }

    private var runnable: WatchSession {
        var copy = session
        copy.blocks = blocks
        return copy
    }

    var body: some View {
        List {
            if !session.detailed {
                notYetHere
            } else {
                ForEach(blocks) { block in
                    Section {
                        ForEach(block.items) { item in
                            HStack(alignment: .firstTextBaseline) {
                                Text(item.name)
                                    .font(Theme.display(13, .semibold, relativeTo: .footnote)).foregroundStyle(Theme.linen)
                                Spacer()
                                Text(item.spec)
                                    .font(Theme.mono(11, relativeTo: .caption2))
                                    .foregroundStyle(Theme.textMute)
                            }
                            .listRowBackground(Color.clear)
                        }
                    } header: {
                        Text(block.label).font(Theme.display(11, .semibold, relativeTo: .caption2)).foregroundStyle(Theme.textDim)
                    }
                }

                Section {
                    actions
                }
                .listRowBackground(Color.clear)
            }
        }
        .navigationTitle(session.title)
        .background(Color.black)
    }

    private var actions: some View {
        HStack(spacing: 8) {
            NavigationLink {
                StrengthTimerView(session: runnable)
            } label: {
                Text("Start")
                    .font(Theme.display(15, .bold, relativeTo: .callout))
                    .foregroundStyle(Theme.forest)
                    .frame(maxWidth: .infinity)
            }
            .listRowBackground(Color.clear)
            .tint(Theme.sage)
            .buttonStyle(.borderedProminent)

            Button {
                condensed.toggle()
            } label: {
                Text(condensed ? "All of it" : "Less time")
                    .font(Theme.display(13, .bold, relativeTo: .caption))
                    .foregroundStyle(Theme.sage)
            }
            .buttonStyle(.bordered)
        }
    }

    /** Not a failure — a session the phone deliberately did not send yet. Said plainly. */
    private var notYetHere: some View {
        VStack(spacing: 6) {
            Image(systemName: "iphone")
                .foregroundStyle(Theme.textDim)
            Text(session.subtitle)
                .font(Theme.display(13, .regular, relativeTo: .footnote))
                .foregroundStyle(Theme.linen)
            Text("The details arrive closer to the day.")
                .font(Theme.display(12, .regular, relativeTo: .caption2))
                .foregroundStyle(Theme.textMute)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .listRowBackground(Color.clear)
    }
}
