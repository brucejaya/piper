import Foundation

enum BillingProduct: String, CaseIterable, Identifiable, Equatable {
    case monthly = "app.piper.ios.monthly"
    case annual = "app.piper.ios.annual"
    case lifetime = "app.piper.ios.lifetime"

    var id: String { rawValue }

    init?(productID: String) {
        self.init(rawValue: productID)
    }

    var displayName: String {
        switch self {
        case .monthly:
            return "Monthly"
        case .annual:
            return "Annual"
        case .lifetime:
            return "Lifetime"
        }
    }

    var presentationRank: Int {
        switch self {
        case .lifetime:
            return 0
        case .annual:
            return 1
        case .monthly:
            return 2
        }
    }
}

struct BillingOffer: Identifiable, Equatable {
    let product: BillingProduct
    let displayName: String
    let price: String

    var id: String { product.id }
}

struct EntitlementState: Equatable {
    var activeProducts: Set<BillingProduct>
    var expirationDates: [BillingProduct: Date]
    var verifiedAt: Date?

    static let none = EntitlementState(activeProducts: [], expirationDates: [:], verifiedAt: nil)

    var preferredProduct: BillingProduct? {
        activeProducts.sorted { lhs, rhs in
            lhs.presentationRank < rhs.presentationRank
        }.first
    }

    func unlocksOfficialApp(at date: Date = Date()) -> Bool {
        activeProducts.contains { product in
            if product == .lifetime {
                return true
            }

            guard let expirationDate = expirationDates[product] else {
                return true
            }

            return expirationDate > date
        }
    }
}
