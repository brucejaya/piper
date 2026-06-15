import XCTest
@testable import PiperApp

@MainActor
final class BillingStoreTests: XCTestCase {
    func testRefreshSortsOffersWithLifetimeFirst() async throws {
        let store = BillingStore(client: PreviewBillingClient(offers: [
            BillingOffer(product: .monthly, displayName: "Monthly", price: "GBP 4.99"),
            BillingOffer(product: .lifetime, displayName: "Lifetime", price: "GBP 99.00"),
            BillingOffer(product: .annual, displayName: "Annual", price: "GBP 39.00")
        ]))

        store.refresh()
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertEqual(store.offers.map(\.product), [.lifetime, .annual, .monthly])
    }

    func testPurchaseUpdatesEntitlementWithoutProtocolState() async throws {
        let store = BillingStore(client: PreviewBillingClient())

        store.purchase(.lifetime)
        try await Task.sleep(nanoseconds: 50_000_000)

        XCTAssertTrue(store.entitlement.unlocksOfficialApp())
        XCTAssertEqual(store.entitlement.preferredProduct, .lifetime)
    }
}
