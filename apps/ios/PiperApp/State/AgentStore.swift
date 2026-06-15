import Foundation

@MainActor
final class AgentStore: ObservableObject {
    @Published private(set) var agents: [AgentConnection] = []
    @Published private(set) var events: [SessionEvent] = []
    @Published private(set) var pendingApprovals: [PendingApproval] = []
    @Published private(set) var pendingAuthRequests: [PendingAuthRequest] = []
    @Published private(set) var peerSeedAvailable = false

    private static let historyLimit = 500
    private static let approvalTTL: TimeInterval = 300
    private static let authTTL: TimeInterval = 300

    private let bridge: PiperBridge
    private let identityStore: PeerIdentityStore
    private let historyStore: SessionHistoryStore
    private let registryStore: AgentRegistryStore
    private var eventTask: Task<Void, Never>?
    private var locallyRemovedInstanceKeys = Set<String>()

    init(
        bridge: PiperBridge,
        identityStore: PeerIdentityStore,
        historyStore: SessionHistoryStore = MemorySessionHistoryStore(),
        registryStore: AgentRegistryStore = MemoryAgentRegistryStore()
    ) {
        self.bridge = bridge
        self.identityStore = identityStore
        self.historyStore = historyStore
        self.registryStore = registryStore
        self.events = (try? historyStore.loadRecent(limit: Self.historyLimit)) ?? []
        self.agents = ((try? registryStore.loadAgents()) ?? []).map(Self.agentConnection)
        startEventLoop()
        peerSeedAvailable = (try? identityStore.loadOrCreateSeed()) != nil
    }

    deinit {
        eventTask?.cancel()
    }

    func addAgent(instanceKey: String) {
        guard agents.contains(where: { $0.instanceKey == instanceKey }) == false else {
            return
        }
        locallyRemovedInstanceKeys.remove(instanceKey)
        agents.append(AgentConnection(
            id: instanceKey,
            instanceKey: instanceKey,
            label: "Unpaired Agent",
            shortKey: Self.shortKey(instanceKey),
            state: .disconnected,
            presence: nil,
            lastActivity: nil
        ))
        persistAgents()
    }

    func removeAgent(_ agent: AgentConnection) {
        locallyRemovedInstanceKeys.insert(agent.instanceKey)
        agents.removeAll { $0.instanceKey == agent.instanceKey }
        pendingApprovals.removeAll { $0.agentId == agent.id }
        pendingAuthRequests.removeAll { $0.agentId == agent.id }
        persistAgents()

        Task {
            await bridge.disconnectAgent(instanceKey: agent.instanceKey)
        }
    }

    func connect(_ agent: AgentConnection) {
        Task {
            try? await bridge.connectAgent(instanceKey: agent.instanceKey)
        }
    }

    func disconnect(_ agent: AgentConnection) {
        Task {
            await bridge.disconnectAgent(instanceKey: agent.instanceKey)
        }
    }

    func handleWake(_ payload: PushWakePayload, now: Date = Date()) {
        guard payload.isExpired(now: now) == false,
              let agent = agents.first(where: { Self.matchesWakeAgent($0, identifier: payload.agent) }) else {
            return
        }

        connect(agent)
    }

    func sendPrompt(_ text: String, to agent: AgentConnection) {
        Task {
            try? await bridge.sendPrompt(instanceKey: agent.instanceKey, text: text, streamingBehavior: nil)
        }
    }

    func approve(_ approval: PendingApproval, reason: String? = nil) {
        resolveApproval(approval, decision: .allow, reason: reason)
    }

    func block(_ approval: PendingApproval, reason: String? = nil) {
        resolveApproval(approval, decision: .block, reason: reason)
    }

    func completeAuth(_ request: PendingAuthRequest, note: String? = nil) {
        resolveAuth(request, status: .completed, note: note)
    }

    func cancelAuth(_ request: PendingAuthRequest, note: String? = nil) {
        resolveAuth(request, status: .cancelled, note: note)
    }

    func rejectAuth(_ request: PendingAuthRequest, note: String? = nil) {
        resolveAuth(request, status: .rejected, note: note)
    }

    private func startEventLoop() {
        eventTask = Task { [weak self] in
            guard let self else { return }
            for await event in bridge.events {
                await handle(event)
            }
        }
    }

    private func handle(_ event: PiperBridgeEvent) {
        switch event {
        case .connectionState(let instanceKey, let state):
            updateAgent(instanceKey: instanceKey) { agent in
                agent.state = state
                agent.lastActivity = Date()
            }
        case .hello(let protocolVersion, let instance):
            let state: ConnectionState = protocolVersion == PiperProtocol.currentVersion ? .connected : .incompatible
            updateAgent(instanceKey: instance.publicKey) { agent in
                agent.label = instance.label
                agent.presence = instance
                agent.state = state
                agent.lastActivity = Date()
            }
            persistAgents()
        case .presence(let presence):
            updateAgent(instanceKey: presence.publicKey) { agent in
                agent.label = presence.label
                agent.presence = presence
                agent.lastActivity = Date()
            }
            persistAgents()
        case .surface(let surface):
            let agentId = surface.source["session"] ?? "unknown"
            handleAuthSurface(surface, agentId: agentId)
            appendEvent(SessionEvent(
                id: surface.id,
                agentId: agentId,
                date: Date(timeIntervalSince1970: TimeInterval(surface.ts) / 1000),
                title: surface.display?.title ?? surface.summary,
                detail: surface.fallback,
                surface: surface
            ))
        case .rawEvent(let instanceKey, let event):
            let now = Date()
            let agentId = instanceKey ?? "event"
            if let instanceKey {
                updateAgent(instanceKey: instanceKey) { agent in
                    agent.lastActivity = now
                }
                persistAgents()
            }
            appendEvent(SessionEvent(
                id: "\(agentId)-\(event.type)-\(now.timeIntervalSince1970)",
                agentId: agentId,
                date: now,
                title: event.title,
                detail: event.detail,
                surface: nil
            ))
        case .approvalRequest(let id, let toolName, let inputSummary):
            upsertApproval(id: id, toolName: toolName, inputSummary: inputSummary)
            appendEvent(SessionEvent(
                id: id,
                agentId: "approval",
                date: Date(),
                title: "Approval requested: \(toolName)",
                detail: inputSummary,
                surface: nil
            ))
        case .response, .error:
            break
        }
    }

    private func handleAuthSurface(_ surface: SurfaceEnvelope, agentId: String) {
        switch surface.type {
        case "auth.request":
            upsertAuthRequest(surface, agentId: agentId)
        case "auth.result":
            guard let requestId = string("requestId", in: surface.payload),
                  let rawStatus = string("status", in: surface.payload),
                  let status = AuthHandoffStatus(rawValue: rawStatus),
                  let index = pendingAuthRequests.firstIndex(where: { $0.id == requestId }) else {
                return
            }
            pendingAuthRequests[index].status = status
        default:
            return
        }
    }

    private func upsertApproval(id: String, toolName: String, inputSummary: String) {
        let now = Date()
        let approval = PendingApproval(
            id: id,
            agentId: "approval",
            toolName: toolName,
            inputSummary: inputSummary,
            receivedAt: now,
            expiresAt: now.addingTimeInterval(Self.approvalTTL),
            status: .pending
        )

        pendingApprovals.removeAll { $0.id == id }
        pendingApprovals.insert(approval, at: 0)
    }

    private func resolveApproval(_ approval: PendingApproval, decision: ApprovalDecision, reason: String?) {
        guard let index = pendingApprovals.firstIndex(where: { $0.id == approval.id }),
              pendingApprovals[index].isActionable else {
            return
        }

        pendingApprovals[index].status = decision == .allow ? .allowed : .blocked
        appendEvent(SessionEvent(
            id: "\(approval.id)-\(decision.rawValue)",
            agentId: approval.agentId,
            date: Date(),
            title: decision == .allow ? "Approval allowed" : "Approval blocked",
            detail: reason ?? approval.toolName,
            surface: nil
        ))

        Task {
            try? await bridge.sendApproval(id: approval.id, decision: decision, reason: reason)
        }
    }

    private func upsertAuthRequest(_ surface: SurfaceEnvelope, agentId: String) {
        let now = Date()
        let expiresAt = number("expiresAt", in: surface.payload).map {
            Date(timeIntervalSince1970: $0 / 1000)
        } ?? now.addingTimeInterval(Self.authTTL)

        let request = PendingAuthRequest(
            id: surface.id,
            agentId: agentId,
            mode: string("mode", in: surface.payload) ?? "open_url",
            origin: string("origin", in: surface.payload) ?? "",
            domain: string("domain", in: surface.payload) ?? surface.display?.subtitle ?? "Unknown domain",
            reason: string("reason", in: surface.payload) ?? surface.fallback,
            requestedScope: string("requestedScope", in: surface.payload),
            sessionDestination: string("sessionDestination", in: surface.payload),
            receivedAt: now,
            expiresAt: expiresAt,
            status: expiresAt > now ? .pending : .expired
        )

        pendingAuthRequests.removeAll { $0.id == surface.id }
        pendingAuthRequests.insert(request, at: 0)
    }

    private func resolveAuth(_ request: PendingAuthRequest, status: AuthResultStatus, note: String?) {
        guard let index = pendingAuthRequests.firstIndex(where: { $0.id == request.id }),
              pendingAuthRequests[index].isActionable else {
            return
        }

        pendingAuthRequests[index].status = AuthHandoffStatus(rawValue: status.rawValue) ?? .failed
        appendEvent(SessionEvent(
            id: "\(request.id)-\(status.rawValue)",
            agentId: request.agentId,
            date: Date(),
            title: "Authentication \(status.rawValue)",
            detail: note ?? request.domain,
            surface: nil
        ))

        Task {
            try? await bridge.sendAuthResult(id: request.id, status: status, note: note)
        }
    }

    private func appendEvent(_ event: SessionEvent) {
        events.removeAll { $0.id == event.id }
        events.insert(event, at: 0)
        if events.count > Self.historyLimit {
            events = Array(events.prefix(Self.historyLimit))
        }
        try? historyStore.append(event, limit: Self.historyLimit)
    }

    private func updateAgent(instanceKey: String, update: (inout AgentConnection) -> Void) {
        if let index = agents.firstIndex(where: { $0.instanceKey == instanceKey }) {
            update(&agents[index])
        } else {
            guard locallyRemovedInstanceKeys.contains(instanceKey) == false else {
                return
            }
            var agent = AgentConnection(
                id: instanceKey,
                instanceKey: instanceKey,
                label: "Agent",
                shortKey: Self.shortKey(instanceKey),
                state: .disconnected,
                presence: nil,
                lastActivity: nil
            )
            update(&agent)
            agents.append(agent)
        }
    }

    private func persistAgents() {
        let existingRecords = ((try? registryStore.loadAgents()) ?? []).reduce(into: [String: AgentRecord]()) { records, record in
            records[record.id] = record
        }
        let records = agents.map { agent in
            AgentRecord(
                id: agent.id,
                instanceKey: agent.instanceKey,
                label: agent.label,
                shortKey: agent.shortKey,
                addedAt: existingRecords[agent.id]?.addedAt ?? Date(),
                lastConnectedAt: agent.lastActivity
            )
        }
        try? registryStore.saveAgents(records)
    }

    private static func agentConnection(from record: AgentRecord) -> AgentConnection {
        AgentConnection(
            id: record.id,
            instanceKey: record.instanceKey,
            label: record.label,
            shortKey: record.shortKey,
            state: .disconnected,
            presence: nil,
            lastActivity: record.lastConnectedAt
        )
    }

    static func shortKey(_ key: String) -> String {
        key.count > 13 ? "\(key.prefix(12))..." : key
    }

    private static func matchesWakeAgent(_ agent: AgentConnection, identifier: String) -> Bool {
        agent.id == identifier ||
            agent.shortKey == identifier ||
            agent.instanceKey == identifier ||
            agent.instanceKey.hasPrefix(identifier)
    }

    private func string(_ key: String, in payload: [String: JSONValue]) -> String? {
        guard let value = payload[key] else {
            return nil
        }

        switch value {
        case .string(let value):
            return value.isEmpty ? nil : value
        case .number(let value):
            return value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
        case .bool(let value):
            return value ? "true" : "false"
        default:
            return nil
        }
    }

    private func number(_ key: String, in payload: [String: JSONValue]) -> Double? {
        guard let rawValue = payload[key],
              case .number(let value) = rawValue else {
            return nil
        }
        return value
    }
}
