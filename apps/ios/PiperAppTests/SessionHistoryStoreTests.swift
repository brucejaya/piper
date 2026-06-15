import XCTest
@testable import PiperApp

final class SessionHistoryStoreTests: XCTestCase {
    func testFileStorePersistsRecentEventsNewestFirst() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = FileSessionHistoryStore(fileURL: directory.appendingPathComponent("history.json"))

        try store.append(event(id: "older", date: Date(timeIntervalSince1970: 1)), limit: 10)
        try store.append(event(id: "newer", date: Date(timeIntervalSince1970: 2)), limit: 10)

        let reloaded = FileSessionHistoryStore(fileURL: directory.appendingPathComponent("history.json"))
        let events = try reloaded.loadRecent(limit: 10)

        XCTAssertEqual(events.map(\.id), ["newer", "older"])
    }

    func testFileStoreDeduplicatesAndPrunesEvents() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = FileSessionHistoryStore(fileURL: directory.appendingPathComponent("history.json"))

        try store.append(event(id: "one", title: "First"), limit: 2)
        try store.append(event(id: "two", title: "Second"), limit: 2)
        try store.append(event(id: "one", title: "Updated"), limit: 2)
        try store.append(event(id: "three", title: "Third"), limit: 2)

        let events = try store.loadRecent(limit: 10)

        XCTAssertEqual(events.map(\.id), ["three", "one"])
        XCTAssertEqual(events.last?.title, "Updated")
    }

    private func event(id: String, title: String = "Title", date: Date = Date()) -> SessionEvent {
        SessionEvent(
            id: id,
            agentId: "agent",
            date: date,
            title: title,
            detail: "Detail",
            surface: nil
        )
    }
}
