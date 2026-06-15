import SwiftUI

struct SessionView: View {
    @EnvironmentObject private var store: AgentStore
    let agent: AgentConnection
    @State private var prompt = ""

    var body: some View {
        VStack(spacing: 0) {
            List {
                Section("Status") {
                    LabeledContent("Connection", value: agent.state.rawValue)
                    LabeledContent("Key", value: agent.shortKey)
                    if let presence = agent.presence {
                        LabeledContent("Working Directory", value: presence.cwd)
                        LabeledContent("Model", value: presence.model ?? "Unknown")
                    }
                }

                Section("Recent Activity") {
                    ForEach(store.events.filter { $0.agentId == agent.id || $0.agentId == "approval" }) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.title)
                                .font(.subheadline)
                            Text(event.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            HStack {
                TextField("Prompt", text: $prompt)
                    .textFieldStyle(.roundedBorder)
                Button("Send") {
                    store.sendPrompt(prompt, to: agent)
                    prompt = ""
                }
                .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding()
        }
        .navigationTitle(agent.label)
        .toolbar {
            Button(agent.state == .connected ? "Disconnect" : "Connect") {
                if agent.state == .connected {
                    store.disconnect(agent)
                } else {
                    store.connect(agent)
                }
            }
        }
    }
}
