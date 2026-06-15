import Foundation

final class TransportPiperBridge: PiperBridge {
    private let session: PiperTransportSession
    private let codec: PiperWireCodec
    private let lineDecoder: PiperLineDecoder
    private let continuation: AsyncStream<PiperBridgeEvent>.Continuation
    let events: AsyncStream<PiperBridgeEvent>
    private var readTask: Task<Void, Never>?
    private var activeInstanceKey: String?

    init(session: PiperTransportSession, codec: PiperWireCodec = PiperWireCodec()) {
        self.session = session
        self.codec = codec
        self.lineDecoder = PiperLineDecoder(codec: codec)

        var captured: AsyncStream<PiperBridgeEvent>.Continuation!
        self.events = AsyncStream { continuation in
            captured = continuation
        }
        self.continuation = captured
    }

    deinit {
        readTask?.cancel()
    }

    func connectAgent(instanceKey: String) async throws {
        activeInstanceKey = instanceKey
        continuation.yield(.connectionState(instanceKey: instanceKey, state: .connecting))
        try await session.connect(instanceKey: instanceKey)
        startReading()
    }

    func disconnectAgent(instanceKey: String) async {
        await session.disconnect()
        continuation.yield(.connectionState(instanceKey: instanceKey, state: .disconnected))
    }

    func sendPrompt(instanceKey: String, text: String, streamingBehavior: String?) async throws {
        try await send(.prompt(id: UUID().uuidString, message: text, streamingBehavior: streamingBehavior))
    }

    func sendSteer(instanceKey: String, text: String) async throws {
        try await send(.steer(id: UUID().uuidString, message: text))
    }

    func abort(instanceKey: String) async throws {
        try await send(.abort(id: UUID().uuidString))
    }

    func getState(instanceKey: String) async throws {
        try await send(.getState(id: UUID().uuidString))
    }

    func getMessages(instanceKey: String) async throws {
        try await send(.getMessages(id: UUID().uuidString))
    }

    func sendApproval(id: String, decision: ApprovalDecision, reason: String?) async throws {
        try await send(.approvalResponse(id: id, decision: decision, reason: reason))
    }

    func sendAuthResult(id: String, status: AuthResultStatus, note: String?) async throws {
        try await send(.authResult(id: id, status: status, note: note))
    }

    private func send(_ message: PiperClientMessage) async throws {
        try await session.send(try codec.encode(message))
    }

    private func startReading() {
        guard readTask == nil else {
            return
        }

        readTask = Task { [weak self] in
            guard let self else { return }
            for await frame in session.frames {
                for message in lineDecoder.append(frame) {
                    emit(message)
                }
            }
        }
    }

    private func emit(_ message: PiperServerMessage) {
        switch message {
        case .hello(let protocolVersion, let instance):
            continuation.yield(.hello(protocolVersion: protocolVersion, instance: instance))
        case .presence(let presence):
            continuation.yield(.presence(presence))
        case .surface(let surface):
            continuation.yield(.surface(instanceKey: activeInstanceKey, surface: surface))
        case .response(let id, let ok, let error):
            continuation.yield(.response(id: id, ok: ok, error: error))
        case .approvalRequest(let id, let toolName, let input):
            continuation.yield(.approvalRequest(
                instanceKey: activeInstanceKey,
                id: id,
                toolName: toolName,
                inputSummary: Self.inputSummary(input)
            ))
        case .event(let event):
            continuation.yield(.rawEvent(instanceKey: activeInstanceKey, event: RawAgentEvent.make(from: event)))
        case .unknown(let type):
            continuation.yield(.error(instanceKey: activeInstanceKey, message: "Unknown message type: \(type)"))
        }
    }

    private static func inputSummary(_ value: JSONValue) -> String {
        switch value {
        case .string(let value):
            return value
        case .number(let value):
            return String(value)
        case .bool(let value):
            return String(value)
        case .object(let value):
            return value.keys.sorted().joined(separator: ", ")
        case .array(let value):
            return "\(value.count) items"
        case .null:
            return ""
        }
    }
}
