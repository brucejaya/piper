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

                Section("Approvals") {
                    let approvals = store.pendingApprovals.filter { $0.agentId == agent.id || $0.agentId == "approval" }
                    if approvals.isEmpty {
                        Text("No pending approvals")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(approvals) { approval in
                            ApprovalCard(approval: approval)
                        }
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

private struct ApprovalCard: View {
    @EnvironmentObject private var store: AgentStore
    let approval: PendingApproval

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(approval.toolName)
                    .font(.headline)
                Spacer()
                Text(approval.status.rawValue)
                    .font(.caption)
                    .foregroundStyle(approval.isActionable ? .orange : .secondary)
            }

            Text(approval.inputSummary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(4)

            if approval.isActionable {
                HStack {
                    Button("Block") {
                        store.block(approval)
                    }
                    .buttonStyle(.bordered)

                    Button("Allow") {
                        store.approve(approval)
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
