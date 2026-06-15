import SwiftUI

@main
struct PiperApp: App {
    @StateObject private var store = AgentStore(
        bridge: MockPiperBridge(),
        identityStore: MemoryPeerIdentityStore()
    )

    var body: some Scene {
        WindowGroup {
            AgentDashboardView()
                .environmentObject(store)
        }
    }
}
