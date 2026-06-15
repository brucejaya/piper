import Foundation
import StoreKit

struct StoreKitBillingClient: BillingClient {
    func loadOffers() async throws -> [BillingOffer] {
        let storeProducts = try await Product.products(for: BillingProduct.allCases.map(\.id))

        return storeProducts.compactMap { storeProduct in
            guard let billingProduct = BillingProduct(productID: storeProduct.id) else {
                return nil
            }

            return BillingOffer(
                product: billingProduct,
                displayName: storeProduct.displayName,
                price: storeProduct.displayPrice
            )
        }
    }

    func currentEntitlement() async -> EntitlementState {
        await entitlementFromCurrentTransactions()
    }

    func purchase(_ product: BillingProduct) async throws -> EntitlementState {
        let storeProducts = try await Product.products(for: [product.id])
        guard let storeProduct = storeProducts.first else {
            throw BillingError.productUnavailable(product)
        }

        let result = try await storeProduct.purchase()
        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification else {
                throw BillingError.unverifiedTransaction
            }
            await transaction.finish()
            return await entitlementFromCurrentTransactions()
        case .userCancelled:
            throw BillingError.purchaseCancelled
        case .pending:
            throw BillingError.purchasePending
        @unknown default:
            throw BillingError.purchasePending
        }
    }

    func restorePurchases() async throws -> EntitlementState {
        try await AppStore.sync()
        return await entitlementFromCurrentTransactions()
    }

    private func entitlementFromCurrentTransactions() async -> EntitlementState {
        var activeProducts = Set<BillingProduct>()
        var expirationDates: [BillingProduct: Date] = [:]

        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  transaction.revocationDate == nil,
                  let product = BillingProduct(productID: transaction.productID) else {
                continue
            }

            activeProducts.insert(product)
            if let expirationDate = transaction.expirationDate {
                expirationDates[product] = expirationDate
            }
        }

        return EntitlementState(
            activeProducts: activeProducts,
            expirationDates: expirationDates,
            verifiedAt: Date()
        )
    }
}
