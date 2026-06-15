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
