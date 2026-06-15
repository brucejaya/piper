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
}
