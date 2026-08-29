import SwiftUI

/** Face 08 — the prescription before starting: blocks, sets × reps @ load, Start beside
 *  Less time (the phone's condense). */
struct SessionDetailView: View {
    let session: WatchSession

    var body: some View {
        List {
            ForEach(session.blocks) { block in
                Section {
                    ForEach(block.items) { item in
                        HStack(alignment: .firstTextBaseline) {
                            Text(item.name)
                                .font(.footnote.weight(.semibold)).foregroundStyle(Theme.linen)
                            Spacer()
                            Text(item.spec)
                                .font(.system(.caption2, design: .monospaced).weight(.bold))
                                .foregroundStyle(Theme.textMute)
                        }
                        .listRowBackground(Color.clear)
                    }
                } header: {
                    Text(block.label).font(.caption2).foregroundStyle(Theme.textDim)
                }
            }
            Section {
                HStack(spacing: 8) {
                    Button {
                        // W2: start the strength timer flow (TimerView per exercise).
                    } label: {
                        Text("Start").font(.callout.weight(.bold)).foregroundStyle(Theme.forest)
                            .frame(maxWidth: .infinity)
                    }
                    .tint(Theme.sage)
                    .buttonStyle(.borderedProminent)

                    Button {
                        // W2: condense() — the phone's Less time.
                    } label: {
                        Text("Less time").font(.caption.weight(.bold)).foregroundStyle(Theme.sage)
                    }
                    .buttonStyle(.bordered)
                }
                .listRowBackground(Color.clear)
            }
        }
        .navigationTitle(session.title)
        .background(Color.black)
    }
}
