import Foundation

@MainActor
final class NotificationStore: ObservableObject {
    @Published private(set) var state: NotificationRegistrationState = .unknown
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastWakePayload: PushWakePayload?

    private let client: NotificationClient

    init(client: NotificationClient) {
        self.client = client
    }

    func refresh() {
        isLoading = true
        lastError = nil

        Task {
            state = await client.currentState()
            isLoading = false
        }
    }

    func requestAuthorization() {
        isLoading = true
        lastError = nil

        Task {
            do {
                state = try await client.requestAuthorization()
            } catch {
                lastError = String(describing: error)
            }
            isLoading = false
        }
    }

    func receiveWake(userInfo: [AnyHashable: Any], now: Date = Date()) -> PushWakePayload? {
        do {
            let payload = try PushWakePayload.decode(userInfo: userInfo, now: now)
            lastWakePayload = payload
            lastError = nil
            return payload
        } catch {
            lastError = String(describing: error)
            return nil
        }
    }
}
