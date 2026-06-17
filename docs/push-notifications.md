# Push Notifications

Push exists only to wake the official iOS app or draw the user's attention. It is not a command relay, session store, protocol authority, or replacement for the paired Piper connection.

## Payload Boundary

Push payloads may include:

- Payload version.
- Event type: `approval`, `auth`, `activity`, or `presence`.
- Short non-secret agent identifier.
- Opaque event reference.
- Issue time and TTL.

Push payloads must not include:

- Prompts.
- Tool inputs.
- Agent messages.
- Session transcripts.
- Credentials, cookies, tokens, one-time codes, or passkeys.
- Approval details that are sufficient to make a decision from the notification alone.

The app should reconnect over Piper after the user opens the notification, then fetch approval or activity details through the paired encrypted connection.

The iOS app mirrors this boundary with a `PushWakePayload` parser. A valid, unexpired wake hint may select a local agent row and trigger reconnect; it must not populate approval, auth, prompt, transcript, or session detail UI from the push payload itself.

## Registration Boundary

Push registration creates a relationship between an iOS installation and an agent instance. It does not pair the app as a protocol peer. Protocol trust still requires the iOS peer public key to be present in the agent allowlist.

Users must be able to revoke push registration from the app and from the agent side. Revoking push should not remove protocol pairing unless the user also revokes the peer key.

Registration records should store:

- Short non-secret agent identifier.
- iOS peer public key.
- Hash of the APNs device token.
- Platform and creation/revocation timestamps.

Registration records should not store raw APNs device tokens in logs, payloads, or exported diagnostics.

## Implementation Notes

The wake payload and registration contracts in this document are consumed by the iOS push service and the agent-side push sender (which lives outside this package). The shape is:

- `PushWakePayload` (versioned, see "Payload Boundary" above; max 512 bytes; rejected if any key matches `password|passkey|otp|token|cookie|secret|credential|transcript|prompt|input|message|content`).
- `PushRegistration` records keyed by `(agent, peerPublicKey, deviceTokenHash)`. The raw APNs device token is never persisted; only its SHA-256. Registrations are idempotent on those three fields, and `revokePeer(agent, peerKey)` removes every active registration for that peer.
