import Foundation

protocol PiperTransportSession: AnyObject {
    var frames: AsyncStream<Data> { get }

    func connect(instanceKey: String) async throws
    func disconnect() async
    func send(_ data: Data) async throws
}

final class MemoryPiperTransportSession: PiperTransportSession {
    private let continuation: AsyncStream<Data>.Continuation
    let frames: AsyncStream<Data>
    private(set) var sentFrames: [Data] = []
    private(set) var connectedInstanceKey: String?

    init() {
        var captured: AsyncStream<Data>.Continuation!
        self.frames = AsyncStream { continuation in
            captured = continuation
        }
        self.continuation = captured
    }

    func connect(instanceKey: String) async throws {
        connectedInstanceKey = instanceKey
    }

    func disconnect() async {
        connectedInstanceKey = nil
    }

    func send(_ data: Data) async throws {
        sentFrames.append(data)
    }

    func emit(_ line: String) {
        continuation.yield(Data(line.utf8))
    }
}
