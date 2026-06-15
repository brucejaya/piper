import Foundation

protocol BillingClient {
    func loadOffers() async throws -> [BillingOffer]
    func currentEntitlement() async -> EntitlementState
    func purchase(_ product: BillingProduct) async throws -> EntitlementState
    func restorePurchases() async throws -> EntitlementState
}

enum BillingError: Error {
    case productUnavailable(BillingProduct)
    case purchaseCancelled
    case purchasePending
    case unverifiedTransaction
}
