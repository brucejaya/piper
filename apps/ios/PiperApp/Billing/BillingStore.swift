import Foundation

@MainActor
final class BillingStore: ObservableObject {
    @Published private(set) var offers: [BillingOffer] = []
    @Published private(set) var entitlement: EntitlementState = .none
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: String?

    private let client: BillingClient

    init(client: BillingClient) {
        self.client = client
    }

    func refresh() {
        isLoading = true
        lastError = nil

        Task {
            async let offers = client.loadOffers()
            let entitlement = await client.currentEntitlement()

            do {
                let loadedOffers = try await offers
                self.offers = loadedOffers.sorted { lhs, rhs in
                    lhs.product.presentationRank < rhs.product.presentationRank
                }
                self.entitlement = entitlement
            } catch {
                lastError = String(describing: error)
                self.entitlement = entitlement
            }

            isLoading = false
        }
    }

    func purchase(_ product: BillingProduct) {
        isLoading = true
        lastError = nil

        Task {
            do {
                entitlement = try await client.purchase(product)
            } catch {
                lastError = String(describing: error)
            }
            isLoading = false
        }
    }

    func restorePurchases() {
        isLoading = true
        lastError = nil

        Task {
            do {
                entitlement = try await client.restorePurchases()
            } catch {
                lastError = String(describing: error)
            }
            isLoading = false
        }
    }
}
