import Foundation
import Security

final class KeychainPeerIdentityStore: PeerIdentityStore {
    private let service: String
    private let account: String

    init(service: String = "app.piper.peer-identity", account: String = "default") {
        self.service = service
        self.account = account
    }

    func loadOrCreateSeed() throws -> Data {
        if let existing = try loadSeed() {
            return existing
        }

        let seed = try createSeed()
        try saveSeed(seed)
        return seed
    }

    private func loadSeed() throws -> Data? {
        var query = baseQuery()
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnData as String] = true

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }

        guard status == errSecSuccess, let data = result as? Data else {
            throw PeerIdentityError.keychainReadFailed(status)
        }

        guard data.count == 32 else {
            throw PeerIdentityError.invalidSeedLength
        }

        return data
    }

    private func createSeed() throws -> Data {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw PeerIdentityError.randomGenerationFailed(status)
        }
        return Data(bytes)
    }

    private func saveSeed(_ seed: Data) throws {
        guard seed.count == 32 else {
            throw PeerIdentityError.invalidSeedLength
        }

        var item = baseQuery()
        item[kSecValueData as String] = seed
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw PeerIdentityError.keychainWriteFailed(status)
        }
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
