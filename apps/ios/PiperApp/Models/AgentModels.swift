import Foundation

struct AgentConnection: Identifiable, Equatable {
    let id: String
    var instanceKey: String
    var label: String
    var shortKey: String
    var state: ConnectionState
    var presence: InstancePresence?
    var lastActivity: Date?

    var isBusy: Bool {
        presence?.streaming ?? false
    }
}

struct SessionEvent: Identifiable, Codable, Equatable {
    let id: String
    let agentId: String
    let date: Date
    let title: String
    let detail: String
    let surface: SurfaceEnvelope?
}

struct RawAgentEvent: Equatable {
    let type: String
    let payload: JSONValue

    var title: String {
        readableType(type)
    }

    var detail: String {
        if case .object(let fields) = payload {
            for key in ["summary", "message", "text", "name", "toolName", "state"] {
                if let value = fields[key].flatMap(Self.scalarString), value.isEmpty == false {
                    return value
                }
            }

            let visibleKeys = fields.keys
                .filter { $0 != "type" }
                .sorted()
                .prefix(5)
            if visibleKeys.isEmpty == false {
                return visibleKeys.joined(separator: ", ")
            }
        }

        return "Agent activity"
    }

    static func make(from value: JSONValue) -> RawAgentEvent {
        let type: String
        if case .object(let fields) = value,
           case .string(let rawType) = fields["type"],
           rawType.isEmpty == false {
            type = rawType
        } else {
            type = "event"
        }

        return RawAgentEvent(type: type, payload: value)
    }

    private static func scalarString(_ value: JSONValue) -> String? {
        switch value {
        case .string(let value):
            return value
        case .number(let value):
            return value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
        case .bool(let value):
            return value ? "true" : "false"
        default:
            return nil
        }
    }

    private func readableType(_ value: String) -> String {
        value
            .split(separator: "_")
            .map { part in
                guard let first = part.first else {
                    return ""
                }
                return first.uppercased() + part.dropFirst()
            }
            .joined(separator: " ")
    }
}

enum ApprovalStatus: String, Codable, Equatable {
    case pending
    case allowed
    case blocked
    case expired
}

struct PendingApproval: Identifiable, Codable, Equatable {
    let id: String
    let agentId: String
    let toolName: String
    let inputSummary: String
    let receivedAt: Date
    let expiresAt: Date
    var status: ApprovalStatus

    var isActionable: Bool {
        status == .pending && expiresAt > Date()
    }
}

enum AuthHandoffStatus: String, Codable, Equatable {
    case pending
    case completed
    case failed
    case expired
    case cancelled
    case rejected
}

struct PendingAuthRequest: Identifiable, Codable, Equatable {
    let id: String
    let agentId: String
    let mode: String
    let origin: String
    let domain: String
    let reason: String
    let requestedScope: String?
    let sessionDestination: String?
    let receivedAt: Date
    let expiresAt: Date
    var status: AuthHandoffStatus

    var isActionable: Bool {
        status == .pending && expiresAt > Date()
    }

    var actionURL: URL? {
        guard let url = URL(string: origin),
              let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased() else {
            return nil
        }

        if scheme == "https" {
            return url
        }

        if scheme == "http" && Self.localDevelopmentHosts.contains(host) {
            return url
        }

        return nil
    }

    private static let localDevelopmentHosts: Set<String> = [
        "localhost",
        "127.0.0.1",
        "::1"
    ]
}
