import SwiftUI

@main
struct PiperApp: App {
    @StateObject private var store = AgentStore(
        bridge: MockPiperBridge(),
        identityStore: KeychainPeerIdentityStore(),
        historyStore: (try? FileSessionHistoryStore.defaultStore()) ?? MemorySessionHistoryStore(),
        registryStore: (try? FileAgentRegistryStore.defaultStore()) ?? MemoryAgentRegistryStore()
    )
    @StateObject private var billingStore = BillingStore(client: StoreKitBillingClient())
    @StateObject private var notificationStore = NotificationStore(client: SystemNotificationClient())

    var body: some Scene {
        WindowGroup {
            AgentDashboardView()
                .environmentObject(store)
                .environmentObject(billingStore)
                .environmentObject(notificationStore)
        }
    }
}
