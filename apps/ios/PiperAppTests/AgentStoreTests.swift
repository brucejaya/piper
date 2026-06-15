import XCTest
@testable import PiperApp

@MainActor
final class AgentStoreTests: XCTestCase {
    func testShortKeyMatchesProtocolStyle() {
        XCTAssertEqual(AgentStore.shortKey("abc"), "abc")
        XCTAssertEqual(AgentStore.shortKey(String(repeating: "a", count: 64)), "aaaaaaaaaaaa...")
    }

    func testAddAgentCreatesDisconnectedEntry() {
        let store = AgentStore(bridge: MockPiperBridge(), identityStore: MemoryPeerIdentityStore())
        let key = String(repeating: "b", count: 64)

        store.addAgent(instanceKey: key)
        store.addAgent(instanceKey: key)

        XCTAssertEqual(store.agents.count, 1)
        XCTAssertEqual(store.agents.first?.state, .disconnected)
        XCTAssertEqual(store.agents.first?.shortKey, "bbbbbbbbbbbb...")
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
}
