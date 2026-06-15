import XCTest
@testable import PiperApp

final class AgentRegistryStoreTests: XCTestCase {
    func testFileRegistryPersistsAgents() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let fileURL = directory.appendingPathComponent("agents.json")
        let store = FileAgentRegistryStore(fileURL: fileURL)

        let record = AgentRecord(
            id: "agent",
            instanceKey: String(repeating: "a", count: 64),
            label: "Laptop",
            shortKey: "aaaaaaaaaaaa...",
            addedAt: Date(timeIntervalSince1970: 1),
            lastConnectedAt: Date(timeIntervalSince1970: 2)
        )

        try store.saveAgents([record])

        let reloaded = FileAgentRegistryStore(fileURL: fileURL)
        XCTAssertEqual(try reloaded.loadAgents(), [record])
    }
}
