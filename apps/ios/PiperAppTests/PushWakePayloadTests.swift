import XCTest
@testable import PiperApp

final class PushWakePayloadTests: XCTestCase {
    func testValidWakePayloadDecodes() throws {
        let now = Date(timeIntervalSince1970: 1_792_080_000)
        let payload = try PushWakePayload.decode(userInfo: [
            "v": 1,
            "event": "approval",
            "agent": "agent-1",
            "ref": "approval-1",
            "issuedAt": now.timeIntervalSince1970 * 1000,
            "ttlSeconds": 300,
            "aps": ["content-available": 1]
        ], now: now)

        XCTAssertEqual(payload.event, .approval)
        XCTAssertEqual(payload.agent, "agent-1")
        XCTAssertEqual(payload.ref, "approval-1")
        XCTAssertEqual(payload.expiresAt, now.addingTimeInterval(300))
    }

    func testExpiredWakePayloadIsRejected() throws {
        let issuedAt = Date(timeIntervalSince1970: 1_792_080_000)

        XCTAssertThrowsError(try PushWakePayload.decode(userInfo: [
            "v": 1,
            "event": "auth",
            "agent": "agent-1",
            "issuedAt": issuedAt.timeIntervalSince1970 * 1000,
            "ttlSeconds": 10
        ], now: issuedAt.addingTimeInterval(11))) { error in
            XCTAssertEqual(error as? PushWakePayloadError, .expired)
        }
    }

    func testSecretLikeWakeFieldsAreRejected() throws {
        let now = Date(timeIntervalSince1970: 1_792_080_000)

        XCTAssertThrowsError(try PushWakePayload.decode(userInfo: [
            "v": 1,
            "event": "activity",
            "agent": "agent-1",
            "issuedAt": now.timeIntervalSince1970 * 1000,
            "ttlSeconds": 300,
            "prompt": "summarize this"
        ], now: now)) { error in
            XCTAssertEqual(error as? PushWakePayloadError, .disallowedField)
        }
    }
}
