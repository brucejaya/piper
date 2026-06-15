import SwiftUI

@main
struct PiperApp: App {
    @StateObject private var store = AgentStore(
        bridge: MockPiperBridge(),
        identityStore: KeychainPeerIdentityStore()
    )
    @StateObject private var billingStore = BillingStore(client: StoreKitBillingClient())

    var body: some Scene {
        WindowGroup {
            AgentDashboardView()
                .environmentObject(store)
                .environmentObject(billingStore)
        }
    }
}
