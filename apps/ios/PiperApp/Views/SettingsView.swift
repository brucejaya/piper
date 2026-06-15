import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var billingStore: BillingStore
    @EnvironmentObject private var notificationStore: NotificationStore

    var body: some View {
        List {
            Section("Official App") {
                LabeledContent("Status", value: billingStore.entitlement.unlocksOfficialApp() ? "Unlocked" : "Locked")
                if let product = billingStore.entitlement.preferredProduct {
                    LabeledContent("Plan", value: product.displayName)
                }
                Button("Restore Purchases") {
                    billingStore.restorePurchases()
                }
                .disabled(billingStore.isLoading)
            }

            Section("Purchase") {
                ForEach(billingStore.offers) { offer in
                    Button {
                        billingStore.purchase(offer.product)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(offer.displayName)
                                Text(offer.product == .lifetime ? "One-time purchase" : "Subscription")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(offer.price)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .disabled(billingStore.isLoading)
                }
            }

            if let error = billingStore.lastError {
                Section("Billing Error") {
                    Text(error)
                        .foregroundStyle(.red)
                }
            }

            Section("Notifications") {
                LabeledContent("Status", value: notificationStore.state.authorizationStatus.rawValue)
                Button("Enable Notifications") {
                    notificationStore.requestAuthorization()
                }
                .disabled(notificationStore.isLoading || notificationStore.state.authorizationStatus == .authorized)
                Text("Notifications are wake hints only. Approval and session details are fetched after reconnecting over Piper.")
                    .foregroundStyle(.secondary)
            }

            if let error = notificationStore.lastError {
                Section("Notification Error") {
                    Text(error)
                        .foregroundStyle(.red)
                }
            }

            Section("Protocol") {
                Text("Purchases unlock the official iOS experience only. Pairing and agent access still require the agent allowlist.")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            if billingStore.offers.isEmpty {
                billingStore.refresh()
            }
            notificationStore.refresh()
        }
    }
}

#Preview {
    NavigationStack {
        SettingsView()
            .environmentObject(BillingStore(client: PreviewBillingClient()))
            .environmentObject(NotificationStore(client: PreviewNotificationClient()))
    }
}
