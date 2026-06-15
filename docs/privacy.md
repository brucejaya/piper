# Privacy

Piper is designed around local-first peer-to-peer control. The open protocol does not require Piper-hosted storage for agent content.

## Local Data

Agent instances store their identity seed and allowlist under `.pi/piper/` on the agent machine.

The official iOS app stores its peer secret in Keychain and may cache recent session activity locally on the device so the app remains useful while offline.

## Hosted Data

The core protocol does not require hosted data.

Paid-app support may introduce narrow hosted services for:

- Push wake delivery through APNs.
- App Store receipt or entitlement validation.

Hosted services must not store prompts, tool inputs, session transcripts, credentials, cookies, refresh tokens, or bearer tokens.

## Purchases

StoreKit entitlement state unlocks official app features. It does not grant access to an agent, pair a peer, or modify an agent allowlist.

## Remote Authentication

Remote authentication handoff should carry non-secret status only. Users may complete authentication on their own device, but Piper should not transmit passwords, passkeys, one-time codes, long-lived cookies, refresh tokens, or bearer tokens through the Piper protocol or push service.
