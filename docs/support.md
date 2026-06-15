# Support

Support should help users recover control of their own agents without making Piper a hosted relay or account authority.

## Pairing Problems

Ask the user to confirm:

- The agent instance public key matches the app target.
- The iOS peer public key was added with `/piper-allow <peer-key>`.
- The peer key is still present in `.pi/piper/allowed.json`.
- The agent is running with the Piper extension loaded.

If a device is lost, revoke it from the agent instance with `/piper-deny <peer-key>`.

## Connectivity Problems

Check:

- Agent process is running.
- HyperDHT bootstrap connectivity is available.
- The app is using the current instance public key.
- The peer key has not been revoked.
- Local firewalls or captive networks are not blocking outbound traffic.

Piper should not ask users to forward ports or assign static IPs for normal operation.

## Approval Problems

Check:

- `PIPER_APPROVALS=remote` is enabled on the agent instance.
- The app is paired and connected.
- The approval request has not expired.
- The user is not acting only from push text; details should be fetched over Piper after reconnect.

Current open-core behavior times out to allow while remote approvals are opt-in. The app must show stale state clearly.

## Purchase Problems

Check:

- The user is signed into the App Store account that purchased Piper.
- Restore purchases was attempted from Settings.
- StoreKit products exist for monthly, annual, and lifetime.
- The entitlement status in Settings reflects the latest restore attempt.

Purchase state does not pair agents or grant protocol access.

## Privacy Questions

Use `docs/privacy.md` as the source of truth. The core protocol does not require Piper-hosted storage for prompts, tool inputs, session transcripts, or credentials.
