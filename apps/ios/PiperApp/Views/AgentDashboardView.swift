import SwiftUI

struct AgentDashboardView: View {
    @EnvironmentObject private var store: AgentStore
    @State private var instanceKey = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("Instance public key", text: $instanceKey)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("Add") {
                            store.addAgent(instanceKey: instanceKey.trimmingCharacters(in: .whitespacesAndNewlines))
                            instanceKey = ""
                        }
                        .disabled(instanceKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                Section {
                    ForEach(store.agents) { agent in
                        NavigationLink {
                            SessionView(agent: agent)
                        } label: {
                            AgentRow(agent: agent)
                        }
                    }
                }
            }
            .navigationTitle("Piper")
        }
    }
}

private struct AgentRow: View {
    let agent: AgentConnection

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(agent.label)
                    .font(.headline)
                Spacer()
                Text(agent.state.rawValue)
                    .font(.caption)
                    .foregroundStyle(agent.state == .connected ? .green : .secondary)
            }
            Text(agent.shortKey)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let presence = agent.presence {
                Text("\(presence.cwd) \(presence.model ?? "")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }
}
