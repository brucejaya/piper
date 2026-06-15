import Foundation

enum PushWakeEvent: String, Codable, Equatable {
    case approval
    case auth
    case activity
    case presence
}

struct PushWakePayload: Codable, Equatable {
    let v: Int
    let event: PushWakeEvent
    let agent: String
    let ref: String?
    let issuedAt: Date
    let ttlSeconds: TimeInterval

    var expiresAt: Date {
        issuedAt.addingTimeInterval(ttlSeconds)
    }

    func isExpired(now: Date = Date()) -> Bool {
        expiresAt <= now
    }

    static func decode(userInfo: [AnyHashable: Any], now: Date = Date()) throws -> PushWakePayload {
        guard containsDisallowedField(userInfo) == false else {
            throw PushWakePayloadError.disallowedField
        }

        let fields = ["v", "event", "agent", "ref", "issuedAt", "ttlSeconds"]
        let payload = userInfo.reduce(into: [String: Any]()) { result, entry in
            guard let key = entry.key as? String, fields.contains(key) else {
                return
            }
            result[key] = entry.value
        }

        let data = try JSONSerialization.data(withJSONObject: payload)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        let decoded = try decoder.decode(PushWakePayload.self, from: data)

        guard decoded.v == 1 else {
            throw PushWakePayloadError.unsupportedVersion
        }
        guard decoded.agent.count >= 6 && decoded.agent.count <= 80 else {
            throw PushWakePayloadError.invalidAgent
        }
        if let ref = decoded.ref, ref.count > 120 {
            throw PushWakePayloadError.invalidReference
        }
        guard decoded.ttlSeconds >= 1 && decoded.ttlSeconds <= 3600 else {
            throw PushWakePayloadError.invalidTTL
        }
        guard decoded.isExpired(now: now) == false else {
            throw PushWakePayloadError.expired
        }

        return decoded
    }

    private static func containsDisallowedField(_ value: Any) -> Bool {
        if let dictionary = value as? [AnyHashable: Any] {
            return dictionary.contains { entry in
                guard let key = entry.key as? String else {
                    return containsDisallowedField(entry.value)
                }
                if key == "aps" {
                    return false
                }
                if key.range(of: disallowedFieldPattern, options: [.regularExpression, .caseInsensitive]) != nil {
                    return true
                }
                return containsDisallowedField(entry.value)
            }
        }

        if let array = value as? [Any] {
            return array.contains(where: containsDisallowedField)
        }

        return false
    }

    private static let disallowedFieldPattern = "password|passkey|otp|token|cookie|secret|credential|transcript|prompt|input|message|content"
}

enum PushWakePayloadError: Error, Equatable {
    case unsupportedVersion
    case invalidAgent
    case invalidReference
    case invalidTTL
    case expired
    case disallowedField
}
