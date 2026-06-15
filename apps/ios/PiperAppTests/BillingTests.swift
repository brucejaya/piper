import XCTest
@testable import PiperApp

final class BillingTests: XCTestCase {
    func testLifetimeEntitlementUnlocksOfficialApp() {
        let state = EntitlementState(
            activeProducts: [.lifetime],
            expirationDates: [:],
            verifiedAt: Date()
        )

        XCTAssertTrue(state.unlocksOfficialApp())
        XCTAssertEqual(state.preferredProduct, .lifetime)
    }

    func testExpiredSubscriptionDoesNotUnlockOfficialApp() {
        let now = Date(timeIntervalSince1970: 100)
        let state = EntitlementState(
            activeProducts: [.monthly],
            expirationDates: [.monthly: Date(timeIntervalSince1970: 99)],
            verifiedAt: now
        )

        XCTAssertFalse(state.unlocksOfficialApp(at: now))
    }

    func testActiveSubscriptionUnlocksOfficialApp() {
        let now = Date(timeIntervalSince1970: 100)
        let state = EntitlementState(
            activeProducts: [.annual],
            expirationDates: [.annual: Date(timeIntervalSince1970: 101)],
            verifiedAt: now
        )

        XCTAssertTrue(state.unlocksOfficialApp(at: now))
        XCTAssertEqual(state.preferredProduct, .annual)
    }

    func testProductPresentationKeepsLifetimeProminent() {
        let products = BillingProduct.allCases.sorted { lhs, rhs in
            lhs.presentationRank < rhs.presentationRank
        }

        XCTAssertEqual(products, [.lifetime, .annual, .monthly])
    }
}
