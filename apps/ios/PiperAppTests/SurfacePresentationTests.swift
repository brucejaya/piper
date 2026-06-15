import XCTest
@testable import PiperApp

final class SurfacePresentationTests: XCTestCase {
    func testCommitSurfaceUsesNativeCommitPresentation() {
        let surface = makeSurface(type: "git.commit", payload: [
            "repository": .string("piper"),
            "branch": .string("main"),
            "hash": .string("abc123"),
            "summary": .string("Add tests"),
            "tests": .string("passed")
        ])

        let presentation = SurfacePresentation.make(from: surface)

        XCTAssertEqual(presentation.kind, .gitCommit)
        XCTAssertEqual(presentation.title, "Add tests")
        XCTAssertEqual(presentation.subtitle, "piper / main")
        XCTAssertEqual(presentation.detail, "abc123")
        XCTAssertEqual(presentation.status, "passed")
    }

    func testUnknownSurfaceFallsBackSafely() {
        let surface = makeSurface(type: "custom.sale", payload: [
            "amount": .number(42)
        ])

        let presentation = SurfacePresentation.make(from: surface)

        XCTAssertEqual(presentation.kind, .fallback)
        XCTAssertEqual(presentation.subtitle, "custom.sale")
        XCTAssertEqual(presentation.detail, "Fallback text")
    }

    func testAuthRequestShowsDomainAndReason() {
        let surface = makeSurface(type: "auth.request", payload: [
            "domain": .string("example.com"),
            "reason": .string("Agent needs login"),
            "expiresAt": .number(1792080000000)
        ])

        let presentation = SurfacePresentation.make(from: surface)

        XCTAssertEqual(presentation.kind, .auth)
        XCTAssertEqual(presentation.subtitle, "example.com")
        XCTAssertEqual(presentation.detail, "Agent needs login")
        XCTAssertEqual(presentation.status, "1792080000000")
    }

    private func makeSurface(type: String, payload: [String: JSONValue]) -> SurfaceEnvelope {
        SurfaceEnvelope(
            kind: "surface",
            surface: "event",
            type: type,
            id: "surface-1",
            ts: 1792080000000,
            source: ["harness": "pi"],
            schema: SurfaceSchema(version: 1, url: nil),
            summary: "Summary",
            fallback: "Fallback text",
            display: nil,
            payload: payload
        )
    }
}
