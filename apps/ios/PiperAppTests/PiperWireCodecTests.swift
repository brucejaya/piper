import XCTest
@testable import PiperApp

final class PiperWireCodecTests: XCTestCase {
    func testEncodesPromptAsJSONL() throws {
        let codec = PiperWireCodec()

        let data = try codec.encode(.prompt(id: "req-1", message: "Continue", streamingBehavior: "steer"))
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))

        XCTAssertTrue(json.hasSuffix("\n"))
        XCTAssertTrue(json.contains("\"t\":\"prompt\""))
        XCTAssertTrue(json.contains("\"id\":\"req-1\""))
        XCTAssertTrue(json.contains("\"streamingBehavior\":\"steer\""))
    }

    func testDecodesHelloMessage() throws {
        let codec = PiperWireCodec()
        let line = """
        {"t":"hello","protocol":1,"instance":{"publicKey":"abc","label":"workstation","cwd":"/repo","model":"provider/model","streaming":false,"sessionFile":null}}
        """

        let message = try codec.decodeServerMessage(from: line)

        XCTAssertEqual(message, .hello(protocolVersion: 1, instance: InstancePresence(
            publicKey: "abc",
            label: "workstation",
            cwd: "/repo",
            model: "provider/model",
            streaming: false,
            sessionFile: nil
        )))
    }

    func testLineDecoderHandlesPartialCRLFAndMalformedFrames() {
        let decoder = PiperLineDecoder()

        XCTAssertTrue(decoder.append("{\"t\":\"response\",\"id\":\"r1\"").isEmpty)
        let messages = decoder.append(",\"ok\":true}\r\n{not-json}\n")

        XCTAssertEqual(messages, [.response(id: "r1", ok: true, error: nil)])
    }

    func testDecodesApprovalRequestInputAsInertJSON() throws {
        let codec = PiperWireCodec()
        let line = """
        {"t":"approval_request","id":"approval-1","toolName":"bash","input":{"command":"npm test"}}
        """

        let message = try codec.decodeServerMessage(from: line)

        XCTAssertEqual(message, .approvalRequest(
            id: "approval-1",
            toolName: "bash",
            input: .object(["command": .string("npm test")])
        ))
    }
}
