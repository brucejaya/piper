import XCTest
@testable import PiperApp

final class TransportPiperBridgeTests: XCTestCase {
    func testConnectEmitsStateAndReadsHello() async throws {
        let session = MemoryPiperTransportSession()
        let bridge = TransportPiperBridge(session: session)
        var iterator = bridge.events.makeAsyncIterator()

        try await bridge.connectAgent(instanceKey: "agent-key")
        session.emit("""
        {"t":"hello","protocol":1,"instance":{"publicKey":"agent-key","label":"Agent","cwd":"/repo","model":null,"streaming":false,"sessionFile":null}}\n
        """)

        XCTAssertEqual(await iterator.next(), .connectionState(instanceKey: "agent-key", state: .connecting))
        XCTAssertEqual(await iterator.next(), .hello(protocolVersion: 1, instance: InstancePresence(
            publicKey: "agent-key",
            label: "Agent",
            cwd: "/repo",
            model: nil,
            streaming: false,
            sessionFile: nil
        )))
    }

    func testSendApprovalWritesApprovalResponseFrame() async throws {
        let session = MemoryPiperTransportSession()
        let bridge = TransportPiperBridge(session: session)

        try await bridge.sendApproval(id: "approval-1", decision: .block, reason: "unsafe")

        let sent = try XCTUnwrap(String(data: try XCTUnwrap(session.sentFrames.first), encoding: .utf8))
        XCTAssertTrue(sent.contains("\"t\":\"approval_response\""))
        XCTAssertTrue(sent.contains("\"id\":\"approval-1\""))
        XCTAssertTrue(sent.contains("\"decision\":\"block\""))
    }

    func testApprovalRequestMapsInputToSummary() async throws {
        let session = MemoryPiperTransportSession()
        let bridge = TransportPiperBridge(session: session)
        var iterator = bridge.events.makeAsyncIterator()

        try await bridge.connectAgent(instanceKey: "agent-key")
        _ = await iterator.next()
        session.emit("""
        {"t":"approval_request","id":"approval-1","toolName":"bash","input":{"command":"npm test","cwd":"/repo"}}\n
        """)

        XCTAssertEqual(await iterator.next(), .approvalRequest(
            instanceKey: "agent-key",
            id: "approval-1",
            toolName: "bash",
            inputSummary: "command, cwd"
        ))
    }

    func testRawEventFramesEmitAgentActivity() async throws {
        let session = MemoryPiperTransportSession()
        let bridge = TransportPiperBridge(session: session)
        var iterator = bridge.events.makeAsyncIterator()

        try await bridge.connectAgent(instanceKey: "agent-key")
        _ = await iterator.next()
        session.emit("""
        {"t":"event","event":{"type":"assistant_message","message":"Working on it"}}\n
        """)

        XCTAssertEqual(await iterator.next(), .rawEvent(
            instanceKey: "agent-key",
            event: RawAgentEvent.make(from: .object([
                "type": .string("assistant_message"),
                "message": .string("Working on it")
            ]))
        ))
    }

    func testSurfaceFramesIncludeActiveInstanceKey() async throws {
        let session = MemoryPiperTransportSession()
        let bridge = TransportPiperBridge(session: session)
        var iterator = bridge.events.makeAsyncIterator()

        try await bridge.connectAgent(instanceKey: "agent-key")
        _ = await iterator.next()
        session.emit("""
        {"t":"surface","surface":{"kind":"surface","surface":"event","type":"task.update","id":"surface-1","ts":1792080000000,"source":{"harness":"pi","session":".pi/session.jsonl"},"schema":{"version":1},"summary":"Task update","fallback":"Agent started work","display":{"title":"Task update","subtitle":"running","priority":"normal","icon":"play","group":"task"},"payload":{"state":"running"}}}\n
        """)

        guard case .surface(let instanceKey, let surface) = await iterator.next() else {
            XCTFail("expected surface event")
            return
        }

        XCTAssertEqual(instanceKey, "agent-key")
        XCTAssertEqual(surface.id, "surface-1")
    }
}
