import Foundation

struct AgentRecord: Identifiable, Codable, Equatable {
    let id: String
    let instanceKey: String
    var label: String
    var shortKey: String
    var addedAt: Date
    var lastConnectedAt: Date?
}

protocol AgentRegistryStore {
    func loadAgents() throws -> [AgentRecord]
    func saveAgents(_ agents: [AgentRecord]) throws
}

final class MemoryAgentRegistryStore: AgentRegistryStore {
    private var agents: [AgentRecord]

    init(agents: [AgentRecord] = []) {
        self.agents = agents
    }

    func loadAgents() throws -> [AgentRecord] {
        agents
    }

    func saveAgents(_ agents: [AgentRecord]) throws {
        self.agents = agents
    }
}

final class FileAgentRegistryStore: AgentRegistryStore {
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

    static func defaultStore() throws -> FileAgentRegistryStore {
        guard let directory = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first else {
            throw SessionHistoryError.applicationSupportUnavailable
        }

        let piperDirectory = directory.appendingPathComponent("Piper", isDirectory: true)
        return FileAgentRegistryStore(fileURL: piperDirectory.appendingPathComponent("agents.json"))
    }

    func loadAgents() throws -> [AgentRecord] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return []
        }

        let data = try Data(contentsOf: fileURL)
        return try decoder.decode([AgentRecord].self, from: data)
    }

    func saveAgents(_ agents: [AgentRecord]) throws {
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let data = try encoder.encode(agents)
        try data.write(to: fileURL, options: [.atomic])
    }
}
