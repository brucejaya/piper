import XCTest
@testable import PiperApp

@MainActor
final class AgentStoreTests: XCTestCase {
    func testShortKeyMatchesProtocolStyle() {
        XCTAssertEqual(AgentStore.shortKey("abc"), "abc")
        XCTAssertEqual(AgentStore.shortKey(String(repeating: "a", count: 64)), "aaaaaaaaaaaa...")
    }

    func testAddAgentCreatesDisconnectedEntry() {
        let registryStore = MemoryAgentRegistryStore()
        let store = AgentStore(
            bridge: MockPiperBridge(),
            identityStore: MemoryPeerIdentityStore(),
            registryStore: registryStore
        )
        let key = String(repeating: "b", count: 64)

        store.addAgent(instanceKey: key)
        store.addAgent(instanceKey: key)

        XCTAssertEqual(store.agents.count, 1)
        XCTAssertEqual(store.agents.first?.state, .disconnected)
        XCTAssertEqual(store.agents.first?.shortKey, "bbbbbbbbbbbb...")
        XCTAssertEqual((try? registryStore.loadAgents().first?.instanceKey), key)
    }

    func testStoreLoadsPersistedAgents() {
        let record = AgentRecord(
            id: "agent",
            instanceKey: String(repeating: "c", count: 64),
            label: "Workstation",
            shortKey: "cccccccccccc...",
            addedAt: Date(timeIntervalSince1970: 1),
            lastConnectedAt: Date(timeIntervalSince1970: 2)
        )

        let store = AgentStore(
            bridge: MockPiperBridge(),
            identityStore: MemoryPeerIdentityStore(),
            registryStore: MemoryAgentRegistryStore(agents: [record])
        )

        XCTAssertEqual(store.agents.count, 1)
        XCTAssertEqual(store.agents.first?.label, "Workstation")
        XCTAssertEqual(store.agents.first?.state, .disconnected)
    }

    func testRemoveAgentDeletesLocalRegistryRowAndDisconnects() async throws {
        let bridge = MockPiperBridge()
        let registryStore = MemoryAgentRegistryStore()
        let store = AgentStore(
            bridge: bridge,
            identityStore: MemoryPeerIdentityStore(),
            registryStore: registryStore
        )
        let firstKey = String(repeating: "d", count: 64)
        let secondKey = String(repeating: "e", count: 64)

        store.addAgent(instanceKey: firstKey)
        store.addAgent(instanceKey: secondKey)

        guard let firstAgent = store.agents.first(where: { $0.instanceKey == firstKey }) else {
            XCTFail("agent should exist")
            return
        }

        store.removeAgent(firstAgent)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.agents.map(\.instanceKey), [secondKey])
        XCTAssertEqual(try registryStore.loadAgents().map(\.instanceKey), [secondKey])
        XCTAssertEqual(bridge.disconnectedInstanceKeys, [firstKey])
    }

    func testLocallyRemovedAgentIsNotRecreatedByDisconnectEvent() async throws {
        let bridge = MockPiperBridge()
        let store = AgentStore(bridge: bridge, identityStore: MemoryPeerIdentityStore())
        let key = String(repeating: "f", count: 64)

        store.addAgent(instanceKey: key)
        guard let agent = store.agents.first else {
            XCTFail("agent should exist")
            return
        }

        store.removeAgent(agent)
        bridge.emit(.connectionState(instanceKey: key, state: .disconnected))
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(store.agents.isEmpty)
    }

    func testStoreLoadsCachedSessionEvents() {
        let cached = SessionEvent(
            id: "cached",
            agentId: "agent",
            date: Date(timeIntervalSince1970: 1),
            title: "Cached event",
            detail: "From disk",
            surface: nil
        )

        let store = AgentStore(
            bridge: MockPiperBridge(),
            identityStore: MemoryPeerIdentityStore(),
            historyStore: MemorySessionHistoryStore(events: [cached])
        )

        XCTAssertEqual(store.events, [cached])
    }

    func testStoreAppendsBridgeEventsToHistory() async throws {
        let bridge = MockPiperBridge()
        let historyStore = MemorySessionHistoryStore()
        let store = AgentStore(
            bridge: bridge,
            identityStore: MemoryPeerIdentityStore(),
            historyStore: historyStore
        )

        bridge.emit(.approvalRequest(id: "approval-1", toolName: "shell", inputSummary: "npm test"))
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.events.first?.id, "approval-1")
        XCTAssertEqual(try historyStore.loadRecent(limit: 10).first?.id, "approval-1")
    }

    func testApprovalRequestsAreFirstClassAndDeduplicated() async throws {
        let bridge = MockPiperBridge()
        let store = AgentStore(bridge: bridge, identityStore: MemoryPeerIdentityStore())

        bridge.emit(.approvalRequest(id: "approval-1", toolName: "shell", inputSummary: "npm test"))
        bridge.emit(.approvalRequest(id: "approval-1", toolName: "shell", inputSummary: "npm test"))
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.pendingApprovals.count, 1)
        XCTAssertEqual(store.pendingApprovals.first?.toolName, "shell")
        XCTAssertEqual(store.pendingApprovals.first?.status, .pending)
    }

    func testApprovalDecisionSendsBridgeResponseAndRecordsOutcome() async throws {
        let bridge = MockPiperBridge()
        let store = AgentStore(bridge: bridge, identityStore: MemoryPeerIdentityStore())

        bridge.emit(.approvalRequest(id: "approval-1", toolName: "shell", inputSummary: "npm test"))
        try await Task.sleep(nanoseconds: 50_000_000)

        guard let approval = store.pendingApprovals.first else {
            XCTFail("approval should exist")
            return
        }

        store.block(approval, reason: "unsafe")
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.pendingApprovals.first?.status, .blocked)
        XCTAssertEqual(bridge.approvalResponses.first?.id, "approval-1")
        XCTAssertEqual(bridge.approvalResponses.first?.decision, .block)
        XCTAssertEqual(store.events.first?.title, "Approval blocked")
    }

    func testAuthRequestSurfacesBecomeFirstClassHandoffs() async throws {
        let bridge = MockPiperBridge()
        let store = AgentStore(bridge: bridge, identityStore: MemoryPeerIdentityStore())

        bridge.emit(.surface(authRequestSurface(id: "auth-1")))
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.pendingAuthRequests.count, 1)
        XCTAssertEqual(store.pendingAuthRequests.first?.domain, "example.com")
        XCTAssertEqual(store.pendingAuthRequests.first?.requestedScope, "profile")
        XCTAssertEqual(store.pendingAuthRequests.first?.status, .pending)
    }

    func testAuthCompletionSendsMetadataOnlyResultAndRecordsOutcome() async throws {
        let bridge = MockPiperBridge()
        let store = AgentStore(bridge: bridge, identityStore: MemoryPeerIdentityStore())

        bridge.emit(.surface(authRequestSurface(id: "auth-1")))
        try await Task.sleep(nanoseconds: 50_000_000)

        guard let request = store.pendingAuthRequests.first else {
            XCTFail("auth request should exist")
            return
        }

        store.completeAuth(request, note: "signed in on phone")
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.pendingAuthRequests.first?.status, .completed)
        XCTAssertEqual(bridge.authResults.first?.id, "auth-1")
        XCTAssertEqual(bridge.authResults.first?.status, .completed)
        XCTAssertEqual(bridge.authResults.first?.note, "signed in on phone")
        XCTAssertEqual(store.events.first?.title, "Authentication completed")
    }

    func testAuthRequestExposesOnlySafeActionURLs() {
        var request = authRequest(origin: "https://example.com/login")
        XCTAssertEqual(request.actionURL?.absoluteString, "https://example.com/login")

        request = authRequest(origin: "http://localhost:3000/login")
        XCTAssertEqual(request.actionURL?.absoluteString, "http://localhost:3000/login")

        request = authRequest(origin: "http://example.com/login")
        XCTAssertNil(request.actionURL)

        request = authRequest(origin: "javascript:alert(1)")
        XCTAssertNil(request.actionURL)
    }

    private func authRequest(origin: String) -> PendingAuthRequest {
        PendingAuthRequest(
            id: "auth-request",
            agentId: "agent",
            mode: "open_url",
            origin: origin,
            domain: "example.com",
            reason: "Agent needs login",
            requestedScope: "profile",
            sessionDestination: "agent-browser",
            receivedAt: Date(),
            expiresAt: Date().addingTimeInterval(300),
            status: .pending
        )
    }

    private func authRequestSurface(id: String) -> SurfaceEnvelope {
        SurfaceEnvelope(
            kind: "surface",
            surface: "auth",
            type: "auth.request",
            id: id,
            ts: 1792080000000,
            source: ["harness": "pi"],
            schema: SurfaceSchema(version: 1, url: nil),
            summary: "Authentication requested for example.com",
            fallback: "Agent needs login",
            display: SurfaceDisplay(
                title: "Authentication requested",
                subtitle: "example.com",
                priority: "critical",
                icon: "key-round",
                group: "auth"
            ),
            payload: [
                "mode": .string("open_url"),
                "origin": .string("https://example.com/login"),
                "domain": .string("example.com"),
                "reason": .string("Agent needs login"),
                "expiresAt": .number(Date().addingTimeInterval(300).timeIntervalSince1970 * 1000),
                "requestedScope": .string("profile"),
                "sessionDestination": .string("agent-browser")
            ]
        )
    }
}
