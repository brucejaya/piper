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
}
