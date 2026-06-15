import Foundation

protocol SessionHistoryStore {
    func loadRecent(limit: Int) throws -> [SessionEvent]
    func append(_ event: SessionEvent, limit: Int) throws
}

enum SessionHistoryError: Error {
    case applicationSupportUnavailable
}

final class MemorySessionHistoryStore: SessionHistoryStore {
    private var events: [SessionEvent]

    init(events: [SessionEvent] = []) {
        self.events = events
    }

    func loadRecent(limit: Int) throws -> [SessionEvent] {
        Array(events.prefix(limit))
    }

    func append(_ event: SessionEvent, limit: Int) throws {
        events.removeAll { $0.id == event.id }
        events.insert(event, at: 0)
        if events.count > limit {
            events = Array(events.prefix(limit))
        }
    }
}

final class FileSessionHistoryStore: SessionHistoryStore {
    private let fileURL: URL
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(fileURL: URL) {
        self.fileURL = fileURL
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    static func defaultStore() throws -> FileSessionHistoryStore {
        guard let directory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            throw SessionHistoryError.applicationSupportUnavailable
        }

        let piperDirectory = directory.appendingPathComponent("Piper", isDirectory: true)
        return FileSessionHistoryStore(fileURL: piperDirectory.appendingPathComponent("session-history.json"))
    }

    func loadRecent(limit: Int) throws -> [SessionEvent] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return []
        }

        let data = try Data(contentsOf: fileURL)
        let events = try decoder.decode([SessionEvent].self, from: data)
        return Array(events.prefix(limit))
    }

    func append(_ event: SessionEvent, limit: Int) throws {
        var events = try loadRecent(limit: limit)
        events.removeAll { $0.id == event.id }
        events.insert(event, at: 0)
        if events.count > limit {
            events = Array(events.prefix(limit))
        }

        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try encoder.encode(events)
        try data.write(to: fileURL, options: [.atomic])
    }
}
