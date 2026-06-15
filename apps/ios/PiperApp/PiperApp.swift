import SwiftUI

@main
struct PiperApp: App {
    @StateObject private var store = AgentStore(
        bridge: MockPiperBridge(),
        identityStore: KeychainPeerIdentityStore()
    )

    var body: some Scene {
        WindowGroup {
            AgentDashboardView()
                .environmentObject(store)
        }
    }
}
