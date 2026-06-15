import Foundation
import Security

protocol PeerIdentityStore {
    func loadOrCreateSeed() throws -> Data
}

enum PeerIdentityError: Error {
    case invalidSeedLength
    case keychainReadFailed(OSStatus)
    case keychainWriteFailed(OSStatus)
    case randomGenerationFailed(OSStatus)
}

final class MemoryPeerIdentityStore: PeerIdentityStore {
    private var seed: Data?

    func loadOrCreateSeed() throws -> Data {
        if let seed {
            return seed
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw PeerIdentityError.invalidSeedLength
        }
        let data = Data(bytes)
        seed = data
        return data
    }
}
