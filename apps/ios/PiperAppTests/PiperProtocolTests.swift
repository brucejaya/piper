import XCTest
@testable import PiperApp

final class PiperProtocolTests: XCTestCase {
    func testPresenceDecodesHelloPayloadShape() throws {
        let json = """
        {
          "publicKey": "abc",
          "label": "workstation",
          "cwd": "/repo",
          "model": "provider/model",
          "streaming": false,
          "sessionFile": null
        }
        """.data(using: .utf8)!

        let presence = try JSONDecoder().decode(InstancePresence.self, from: json)

        XCTAssertEqual(presence.publicKey, "abc")
        XCTAssertEqual(presence.label, "workstation")
        XCTAssertFalse(presence.streaming)
    }

    func testSurfaceDecodesUnknownPayloadForFallbackRendering() throws {
        let json = """
        {
          "kind": "surface",
          "surface": "event",
          "type": "custom.inventory.low_stock",
          "id": "surface-1",
          "ts": 1792080000000,
          "source": {"harness": "pi"},
          "schema": {"version": 1, "url": null},
          "summary": "Low stock",
          "fallback": "Inventory is low",
          "display": {"title": "Low stock", "subtitle": "SKU", "priority": "normal", "icon": "box", "group": "inventory"},
          "payload": {"remaining": 3}
        }
        """.data(using: .utf8)!

        let surface = try JSONDecoder().decode(SurfaceEnvelope.self, from: json)

        XCTAssertEqual(surface.type, "custom.inventory.low_stock")
        XCTAssertEqual(surface.fallback, "Inventory is low")
        XCTAssertEqual(surface.payload["remaining"], .number(3))
    }
}
