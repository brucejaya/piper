import XCTest
@testable import PiperApp

@MainActor
final class NotificationStoreTests: XCTestCase {
    func testRefreshLoadsCurrentAuthorizationState() async throws {
        let store = NotificationStore(client: PreviewNotificationClient(
            state: NotificationRegistrationState(authorizationStatus: .denied, deviceToken: nil)
        ))

        store.refresh()
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.state.authorizationStatus, .denied)
    }

    func testRequestAuthorizationUpdatesState() async throws {
        let store = NotificationStore(client: PreviewNotificationClient())

        store.requestAuthorization()
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.state.authorizationStatus, .authorized)
        XCTAssertEqual(store.state.deviceToken, "preview-token")
    }

    func testReceiveWakeStoresValidPayload() throws {
        let now = Date(timeIntervalSince1970: 1_792_080_000)
        let store = NotificationStore(client: PreviewNotificationClient())

        let payload = store.receiveWake(userInfo: [
            "v": 1,
            "event": "presence",
            "agent": "agent-1",
            "issuedAt": now.timeIntervalSince1970 * 1000,
            "ttlSeconds": 300
        ], now: now)

        XCTAssertEqual(payload?.event, .presence)
        XCTAssertEqual(store.lastWakePayload?.agent, "agent-1")
        XCTAssertNil(store.lastError)
    }

    func testReceiveWakeReportsInvalidPayload() throws {
        let store = NotificationStore(client: PreviewNotificationClient())

        let payload = store.receiveWake(userInfo: [
            "v": 2,
            "event": "presence",
            "agent": "agent-1",
            "issuedAt": 1_792_080_000_000,
            "ttlSeconds": 300
        ], now: Date(timeIntervalSince1970: 1_792_080_000))

        XCTAssertNil(payload)
        XCTAssertNotNil(store.lastError)
    }
}
