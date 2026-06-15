import Foundation

struct PreviewBillingClient: BillingClient {
    var offers: [BillingOffer]
    var entitlement: EntitlementState

    init(
        offers: [BillingOffer] = [
            BillingOffer(product: .lifetime, displayName: "Lifetime", price: "GBP 99.00"),
            BillingOffer(product: .annual, displayName: "Annual", price: "GBP 39.00"),
            BillingOffer(product: .monthly, displayName: "Monthly", price: "GBP 4.99")
        ],
        entitlement: EntitlementState = .none
    ) {
        self.offers = offers
        self.entitlement = entitlement
    }

    static let standardOffers = [
        BillingOffer(product: .lifetime, displayName: "Lifetime", price: "GBP 99.00"),
        BillingOffer(product: .annual, displayName: "Annual", price: "GBP 39.00"),
        BillingOffer(product: .monthly, displayName: "Monthly", price: "GBP 4.99")
    ]

    func loadOffers() async throws -> [BillingOffer] {
        offers
    }

    func currentEntitlement() async -> EntitlementState {
        entitlement
    }

    func purchase(_ product: BillingProduct) async throws -> EntitlementState {
        EntitlementState(activeProducts: [product], expirationDates: [:], verifiedAt: Date())
    }

    func restorePurchases() async throws -> EntitlementState {
        entitlement
    }
}
