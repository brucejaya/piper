import Foundation

@MainActor
final class AgentStore: ObservableObject {
    @Published private(set) var agents: [AgentConnection] = []
    @Published private(set) var events: [SessionEvent] = []
    @Published private(set) var peerSeedAvailable = false

    private let bridge: PiperBridge
    private let identityStore: PeerIdentityStore
    private var eventTask: Task<Void, Never>?

    init(bridge: PiperBridge, identityStore: PeerIdentityStore) {
        self.bridge = bridge
        self.identityStore = identityStore
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
        agents.append(AgentConnection(
            id: instanceKey,
            instanceKey: instanceKey,
            label: "Unpaired Agent",
            shortKey: Self.shortKey(instanceKey),
            state: .disconnected,
            presence: nil,
            lastActivity: nil
        ))
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

    func sendPrompt(_ text: String, to agent: AgentConnection) {
        Task {
            try? await bridge.sendPrompt(instanceKey: agent.instanceKey, text: text, streamingBehavior: nil)
        }
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
        case .presence(let presence):
            updateAgent(instanceKey: presence.publicKey) { agent in
                agent.label = presence.label
                agent.presence = presence
                agent.lastActivity = Date()
            }
        case .surface(let surface):
            let agentId = surface.source["session"] ?? "unknown"
            events.insert(SessionEvent(
                id: surface.id,
                agentId: agentId,
                date: Date(timeIntervalSince1970: TimeInterval(surface.ts) / 1000),
                title: surface.display?.title ?? surface.summary,
                detail: surface.fallback,
                surface: surface
            ), at: 0)
        case .approvalRequest(let id, let toolName, let inputSummary):
            events.insert(SessionEvent(
                id: id,
                agentId: "approval",
                date: Date(),
                title: "Approval requested: \(toolName)",
                detail: inputSummary,
                surface: nil
            ), at: 0)
        case .response, .error:
            break
        }
    }

    private func updateAgent(instanceKey: String, update: (inout AgentConnection) -> Void) {
        if let index = agents.firstIndex(where: { $0.instanceKey == instanceKey }) {
            update(&agents[index])
        } else {
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

    static func shortKey(_ key: String) -> String {
        key.count > 13 ? "\(key.prefix(12))..." : key
    }
}
