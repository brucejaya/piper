import Foundation

enum PiperProtocol {
    static let currentVersion = 1
    static let minimumSupportedVersion = 1
}

struct InstancePresence: Codable, Equatable, Identifiable {
    var id: String { publicKey }

    let publicKey: String
    let label: String
    let cwd: String
    let model: String?
    let streaming: Bool
    let sessionFile: String?
}

enum ConnectionState: String, Codable, Equatable {
    case disconnected
    case connecting
    case connected
    case reconnecting
    case incompatible
    case failed
}

struct SurfaceEnvelope: Codable, Equatable, Identifiable {
    let kind: String
    let surface: String
    let type: String
    let id: String
    let ts: Int64
    let source: [String: String]
    let schema: SurfaceSchema
    let summary: String
    let fallback: String
    let display: SurfaceDisplay?
    let payload: [String: JSONValue]
}

struct SurfaceSchema: Codable, Equatable {
    let version: Int
    let url: String?
}

struct SurfaceDisplay: Codable, Equatable {
    let title: String?
    let subtitle: String?
    let priority: String?
    let icon: String?
    let group: String?
}

enum ApprovalDecision: String, Codable, Equatable {
    case allow
    case block
}

enum AuthResultStatus: String, Codable, Equatable {
    case completed
    case failed
    case expired
    case cancelled
    case rejected
}

enum JSONValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}
