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

The current repository defines the wake payload contract in `services/push/src/payload.ts` and the registration boundary in `services/push/src/registration.ts`. A later APNs service should consume those contracts and keep all command, approval, auth, and session data on the peer-to-peer Piper channel.
