import Foundation
import UIKit
import UserNotifications

enum NotificationAuthorizationStatus: String, Equatable {
    case notDetermined
    case denied
    case authorized
    case provisional
    case ephemeral
    case unknown
}

struct NotificationRegistrationState: Equatable {
    var authorizationStatus: NotificationAuthorizationStatus
    var deviceToken: String?

    static let unknown = NotificationRegistrationState(authorizationStatus: .unknown, deviceToken: nil)
}

protocol NotificationClient {
    func currentState() async -> NotificationRegistrationState
    func requestAuthorization() async throws -> NotificationRegistrationState
}

struct SystemNotificationClient: NotificationClient {
    func currentState() async -> NotificationRegistrationState {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return NotificationRegistrationState(
            authorizationStatus: Self.map(settings.authorizationStatus),
            deviceToken: nil
        )
    }

    func requestAuthorization() async throws -> NotificationRegistrationState {
        _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        await UIApplication.shared.registerForRemoteNotifications()
        return await currentState()
    }

    private static func map(_ status: UNAuthorizationStatus) -> NotificationAuthorizationStatus {
        switch status {
        case .notDetermined:
            return .notDetermined
        case .denied:
            return .denied
        case .authorized:
            return .authorized
        case .provisional:
            return .provisional
        case .ephemeral:
            return .ephemeral
        @unknown default:
            return .unknown
        }
    }
}

struct PreviewNotificationClient: NotificationClient {
    var state: NotificationRegistrationState = .unknown

    func currentState() async -> NotificationRegistrationState {
        state
    }

    func requestAuthorization() async throws -> NotificationRegistrationState {
        NotificationRegistrationState(authorizationStatus: .authorized, deviceToken: "preview-token")
    }
}
