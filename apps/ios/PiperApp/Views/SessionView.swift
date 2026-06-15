import SwiftUI

struct SessionView: View {
    @EnvironmentObject private var store: AgentStore
    let agentID: String
    @State private var prompt = ""

    var body: some View {
        Group {
            if let agent {
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

                        Section("Authentication") {
                            let requests = store.pendingAuthRequests.filter { $0.agentId == agent.id || $0.agentId == "unknown" }
                            if requests.isEmpty {
                                Text("No pending auth requests")
                                    .foregroundStyle(.secondary)
                            } else {
                                ForEach(requests) { request in
                                    AuthRequestCard(request: request)
                                }
                            }
                        }

                        Section("Recent Activity") {
                            ForEach(store.events.filter { $0.agentId == agent.id || $0.agentId == "approval" }) { event in
                                SessionEventRow(event: event)
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
            } else {
                ContentUnavailableView("Agent Removed", systemImage: "desktopcomputer.trianglebadge.exclamationmark")
                    .navigationTitle("Piper")
            }
        }
    }

    private var agent: AgentConnection? {
        store.agents.first { $0.id == agentID }
    }
}

private struct AuthRequestCard: View {
    @EnvironmentObject private var store: AgentStore
    @Environment(\.openURL) private var openURL
    let request: PendingAuthRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(request.domain)
                    .font(.headline)
                Spacer()
                Text(request.status.rawValue)
                    .font(.caption)
                    .foregroundStyle(request.isActionable ? .orange : .secondary)
            }

            Text(request.origin)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            Text(request.reason)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(4)

            if let requestedScope = request.requestedScope, requestedScope.isEmpty == false {
                LabeledContent("Scope", value: requestedScope)
                    .font(.caption)
            }

            if let sessionDestination = request.sessionDestination, sessionDestination.isEmpty == false {
                LabeledContent("Destination", value: sessionDestination)
                    .font(.caption)
            }

            LabeledContent("Expires", value: request.expiresAt, format: .dateTime.hour().minute())
                .font(.caption)

            if request.isActionable {
                ViewThatFits {
                    authActions
                    authActionsStacked
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var authActions: some View {
        HStack {
            Button("Reject") {
                store.rejectAuth(request)
            }
            .buttonStyle(.bordered)

            Button("Cancel") {
                store.cancelAuth(request)
            }
            .buttonStyle(.bordered)

            if let actionURL = request.actionURL {
                Button {
                    openURL(actionURL)
                } label: {
                    Label("Open", systemImage: "safari")
                }
                .buttonStyle(.borderedProminent)
            }

            Button("Complete") {
                store.completeAuth(request)
            }
            .buttonStyle(.bordered)
        }
    }

    private var authActionsStacked: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button("Reject") {
                store.rejectAuth(request)
            }
            .buttonStyle(.bordered)

            Button("Cancel") {
                store.cancelAuth(request)
            }
            .buttonStyle(.bordered)

            if let actionURL = request.actionURL {
                Button {
                    openURL(actionURL)
                } label: {
                    Label("Open", systemImage: "safari")
                }
                .buttonStyle(.borderedProminent)
            }

            Button("Complete") {
                store.completeAuth(request)
            }
            .buttonStyle(.bordered)
        }
    }
}

private struct SessionEventRow: View {
    let event: SessionEvent

    var body: some View {
        if let surface = event.surface {
            SurfaceRow(presentation: SurfacePresentation.make(from: surface))
        } else {
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

private struct SurfaceRow: View {
    let presentation: SurfacePresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(presentation.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                Spacer()
                if let status = presentation.status {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let subtitle = presentation.subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(presentation.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(4)
        }
        .padding(.vertical, 4)
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
