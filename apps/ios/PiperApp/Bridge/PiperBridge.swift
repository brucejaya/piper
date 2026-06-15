import Foundation

protocol PiperBridge: AnyObject {
    var events: AsyncStream<PiperBridgeEvent> { get }

    func connectAgent(instanceKey: String) async throws
    func disconnectAgent(instanceKey: String) async
    func sendPrompt(instanceKey: String, text: String, streamingBehavior: String?) async throws
    func sendSteer(instanceKey: String, text: String) async throws
    func abort(instanceKey: String) async throws
    func getState(instanceKey: String) async throws
    func getMessages(instanceKey: String) async throws
    func sendApproval(id: String, decision: ApprovalDecision, reason: String?) async throws
    func sendAuthResult(id: String, status: AuthResultStatus, note: String?) async throws
}

enum PiperBridgeEvent: Equatable {
    case connectionState(instanceKey: String, state: ConnectionState)
    case hello(protocolVersion: Int, instance: InstancePresence)
    case presence(InstancePresence)
    case surface(instanceKey: String?, surface: SurfaceEnvelope)
    case rawEvent(instanceKey: String?, event: RawAgentEvent)
    case approvalRequest(instanceKey: String?, id: String, toolName: String, inputSummary: String)
    case response(id: String, ok: Bool, error: String?)
    case error(instanceKey: String?, message: String)
}
