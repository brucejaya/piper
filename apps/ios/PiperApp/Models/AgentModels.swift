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
}
