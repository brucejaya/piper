import Foundation

enum PiperClientMessage: Equatable {
    case prompt(id: String?, message: String, streamingBehavior: String?)
    case steer(id: String?, message: String)
    case abort(id: String?)
    case getState(id: String)
    case getMessages(id: String)
    case approvalResponse(id: String, decision: ApprovalDecision, reason: String?)
    case authResult(id: String, status: AuthResultStatus, note: String?)
}

enum PiperServerMessage: Equatable {
    case hello(protocolVersion: Int, instance: InstancePresence)
    case presence(InstancePresence)
    case surface(SurfaceEnvelope)
    case response(id: String, ok: Bool, error: String?)
    case approvalRequest(id: String, toolName: String, input: JSONValue)
    case event(JSONValue)
    case unknown(type: String)
}

struct PiperWireCodec {
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    func encode(_ message: PiperClientMessage) throws -> Data {
        var data = try encoder.encode(ClientEnvelope(message))
        data.append(0x0A)
        return data
    }

    func decodeServerMessage(from line: String) throws -> PiperServerMessage {
        try decoder.decode(ServerEnvelope.self, from: Data(line.utf8)).message
    }
}

final class PiperLineDecoder {
    private var buffer = ""
    private let codec: PiperWireCodec
    private let maxFrameBytes: Int

    init(codec: PiperWireCodec = PiperWireCodec(), maxFrameBytes: Int = 1024 * 1024) {
        self.codec = codec
        self.maxFrameBytes = maxFrameBytes
    }

    func append(_ data: Data) -> [PiperServerMessage] {
        guard let chunk = String(data: data, encoding: .utf8) else {
            buffer = ""
            return []
        }
        return append(chunk)
    }

    func append(_ chunk: String) -> [PiperServerMessage] {
        buffer += chunk
        var messages: [PiperServerMessage] = []

        while let newlineIndex = buffer.firstIndex(of: "\n") {
            var line = String(buffer[..<newlineIndex])
            buffer = String(buffer[buffer.index(after: newlineIndex)...])

            if line.last == "\r" {
                line.removeLast()
            }

            guard line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
                continue
            }
            guard line.utf8.count <= maxFrameBytes else {
                continue
            }

            if let message = try? codec.decodeServerMessage(from: line) {
                messages.append(message)
            }
        }

        if buffer.utf8.count > maxFrameBytes {
            buffer = ""
        }

        return messages
    }
}

private struct ClientEnvelope: Encodable {
    let message: PiperClientMessage

    init(_ message: PiperClientMessage) {
        self.message = message
    }

    enum CodingKeys: String, CodingKey {
        case t
        case id
        case message
        case streamingBehavior
        case decision
        case reason
        case status
        case note
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch message {
        case .prompt(let id, let message, let streamingBehavior):
            try container.encode("prompt", forKey: .t)
            try container.encodeIfPresent(id, forKey: .id)
            try container.encode(message, forKey: .message)
            try container.encodeIfPresent(streamingBehavior, forKey: .streamingBehavior)
        case .steer(let id, let message):
            try container.encode("steer", forKey: .t)
            try container.encodeIfPresent(id, forKey: .id)
            try container.encode(message, forKey: .message)
        case .abort(let id):
            try container.encode("abort", forKey: .t)
            try container.encodeIfPresent(id, forKey: .id)
        case .getState(let id):
            try container.encode("get_state", forKey: .t)
            try container.encode(id, forKey: .id)
        case .getMessages(let id):
            try container.encode("get_messages", forKey: .t)
            try container.encode(id, forKey: .id)
        case .approvalResponse(let id, let decision, let reason):
            try container.encode("approval_response", forKey: .t)
            try container.encode(id, forKey: .id)
            try container.encode(decision, forKey: .decision)
            try container.encodeIfPresent(reason, forKey: .reason)
        case .authResult(let id, let status, let note):
            try container.encode("auth_result", forKey: .t)
            try container.encode(id, forKey: .id)
            try container.encode(status, forKey: .status)
            try container.encodeIfPresent(note, forKey: .note)
        }
    }
}

private struct ServerEnvelope: Decodable {
    let message: PiperServerMessage

    enum CodingKeys: String, CodingKey {
        case t
        case protocolVersion = "protocol"
        case instance
        case surface
        case id
        case ok
        case error
        case toolName
        case input
        case event
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .t)

        switch type {
        case "hello":
            message = .hello(
                protocolVersion: try container.decode(Int.self, forKey: .protocolVersion),
                instance: try container.decode(InstancePresence.self, forKey: .instance)
            )
        case "presence":
            message = .presence(try container.decode(InstancePresence.self, forKey: .instance))
        case "surface":
            message = .surface(try container.decode(SurfaceEnvelope.self, forKey: .surface))
        case "response":
            message = .response(
                id: try container.decode(String.self, forKey: .id),
                ok: try container.decode(Bool.self, forKey: .ok),
                error: try container.decodeIfPresent(String.self, forKey: .error)
            )
        case "approval_request":
            message = .approvalRequest(
                id: try container.decode(String.self, forKey: .id),
                toolName: try container.decode(String.self, forKey: .toolName),
                input: try container.decode(JSONValue.self, forKey: .input)
            )
        case "event":
            message = .event(try container.decode(JSONValue.self, forKey: .event))
        default:
            message = .unknown(type: type)
        }
    }
}
