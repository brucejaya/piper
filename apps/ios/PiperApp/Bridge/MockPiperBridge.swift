import Foundation

final class MockPiperBridge: PiperBridge {
    private let continuation: AsyncStream<PiperBridgeEvent>.Continuation
    let events: AsyncStream<PiperBridgeEvent>
    private(set) var approvalResponses: [(id: String, decision: ApprovalDecision, reason: String?)] = []
    private(set) var authResults: [(id: String, status: AuthResultStatus, note: String?)] = []

    init() {
        var captured: AsyncStream<PiperBridgeEvent>.Continuation!
        self.events = AsyncStream { continuation in
            captured = continuation
        }
        self.continuation = captured
    }

    func emit(_ event: PiperBridgeEvent) {
        continuation.yield(event)
    }

    func connectAgent(instanceKey: String) async throws {
        continuation.yield(.connectionState(instanceKey: instanceKey, state: .connecting))
        let presence = InstancePresence(
            publicKey: instanceKey,
            label: "Local Piper",
            cwd: "~/Code/Piper",
            model: "mock/model",
            streaming: false,
            sessionFile: nil
        )
        continuation.yield(.hello(protocolVersion: PiperProtocol.currentVersion, instance: presence))
        continuation.yield(.presence(presence))
        continuation.yield(.connectionState(instanceKey: instanceKey, state: .connected))
    }

    func disconnectAgent(instanceKey: String) async {
        continuation.yield(.connectionState(instanceKey: instanceKey, state: .disconnected))
    }

    func sendPrompt(instanceKey: String, text: String, streamingBehavior: String?) async throws {
        continuation.yield(.response(id: UUID().uuidString, ok: true, error: nil))
    }

    func sendSteer(instanceKey: String, text: String) async throws {
        continuation.yield(.response(id: UUID().uuidString, ok: true, error: nil))
    }

    func abort(instanceKey: String) async throws {
        continuation.yield(.response(id: UUID().uuidString, ok: true, error: nil))
    }

    func getState(instanceKey: String) async throws {
        try await connectAgent(instanceKey: instanceKey)
    }

    func getMessages(instanceKey: String) async throws {
        continuation.yield(.response(id: UUID().uuidString, ok: true, error: nil))
    }

    func sendApproval(id: String, decision: ApprovalDecision, reason: String?) async throws {
        approvalResponses.append((id: id, decision: decision, reason: reason))
        continuation.yield(.response(id: id, ok: true, error: nil))
    }

    func sendAuthResult(id: String, status: AuthResultStatus, note: String?) async throws {
        authResults.append((id: id, status: status, note: note))
        continuation.yield(.response(id: id, ok: true, error: nil))
    }
}
