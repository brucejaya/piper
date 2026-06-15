# Piper Security Model

## Summary

Piper's security model is public-key pairing plus encrypted peer-to-peer transport. The instance public key is its address. A manager public key is trusted only after the user adds it to the instance allowlist.

The goal is to make remote control of coding agents understandable and inspectable for self-hosters. Trust is a product feature.

## Assets

- Instance seed at `.pi/piper/seed`.
- Manager peer secret, stored by the manager client.
- Allowlist at `.pi/piper/allowed.json`.
- Agent session messages and tool events.
- Tool approval decisions.
- Typed surface payloads and display hints.
- Remote authentication handoff requests.
- Local iOS cache and Keychain entries when the app exists.
- Push registration records when push support exists.

## Trust Boundaries

### Instance Boundary

The Pi instance controls the allowlist. A peer that is not listed must not receive `hello`, presence, messages, events, approvals, or responses.

### Peer Boundary

A paired manager can send prompts, steering messages, abort requests, state requests, message requests, and approval decisions. Pair only clients you trust to control the agent.

### Hosted-Service Boundary

Piper should not require a hosted service for normal protocol access. Push and receipt services may exist for the paid iOS app, but they must not become command relay, session store, or protocol authority.

### App Entitlement Boundary

Paid iOS entitlement unlocks official app features. It must not grant protocol trust. Protocol trust comes only from the agent allowlist.

### Surface Boundary

Typed surfaces are structured data from a paired agent, not trusted UI code. Clients may use display hints, but agents must not be allowed to send executable UI, HTML, JavaScript, Swift, CSS, or native component definitions.

## What Piper Protects

- Network traffic between paired peers is encrypted by HyperDHT's Noise transport.
- Unknown peers are rejected before protocol messages are exchanged.
- Pairing requires explicit public-key allowlisting.
- The instance seed stays local to the agent machine.
- The iOS peer secret should stay in Keychain.

## What Piper Does Not Protect

- Piper does not make an untrusted paired peer safe.
- Piper does not sandbox Pi tools.
- Piper does not inspect every prompt or tool input for malicious content.
- Piper does not make structured surface payloads truthful.
- Piper does not make remote authentication safe if the user approves the wrong domain or scope.
- Piper does not prevent the agent provider or Pi runtime from seeing their normal data.
- Piper does not revoke a manager key from devices that already cached local history.
- Piper does not guarantee reachability through every network.

## Pairing Guidance

Users should pair only devices they control.

The UI and docs should show:

- Full public key for copy/paste.
- Short fingerprint for human comparison.
- Device label when available.
- Last connected time.
- Clear instructions for removing a peer from `.pi/piper/allowed.json`.

QR codes are acceptable as a convenience, but the QR content is still a public key or pairing payload. QR does not replace trust verification.

## Revocation

Revocation must happen on the agent instance. Removing an agent from a phone only deletes the local client entry.

Required revocation behavior before mobile launch:

- List paired peer keys.
- Remove a paired key with `/piper-deny <peer-key>`.
- Disconnect a currently connected revoked peer.
- Document manual recovery if `allowed.json` is corrupted.

## Remote Approvals

Remote approvals are high leverage and high risk.

Approval UI should show:

- Agent label and fingerprint.
- Tool name.
- Summarized input.
- Whether the app is connected live or showing stale state.
- Timeout state.
- Allow and Block actions.

Approval requests must expire. A stale request should not be actionable after timeout, disconnect, or agent completion.

Current v0 behavior times out to allow. That is acceptable while remote approvals are opt-in, but the iOS product should make timeout behavior visible and configurable before broader release.

## Typed Surfaces

Typed surfaces help clients render agent activity natively, but they also increase the amount of structured context a paired client receives.

Surface clients should:

- Show source agent, harness, and session context when available.
- Render unknown surface types with fallback text.
- Treat display hints as suggestions, not instructions.
- Keep action affordances inert unless the user has granted the relevant permission.
- Avoid rendering arbitrary markup from payloads.
- Redact or collapse large payloads by default.

Agents and extensions should:

- Prefer summaries and metadata over full transcripts or secrets.
- Keep payloads small enough for the protocol frame limit.
- Use `surface.proposal` before expecting elevated treatment for a custom type.
- Avoid sending secrets, credentials, tokens, or private keys in payloads.

## Remote Authentication Handoff

Remote auth handoff is high risk. The safe default is user-assisted authentication without credential sharing.

An `auth.request` should show:

- Requesting agent and peer identity.
- Origin URL and target domain.
- Requested scope or reason.
- Session destination.
- Expiry time.
- Cancel and reject actions.

Auth handoff payloads must not include raw passwords, passkeys, one-time codes, long-lived cookies, refresh tokens, or bearer tokens. The first implementation should return only non-secret completion status such as completed, failed, expired, cancelled, or rejected.

Richer browser session transfer requires a separate reviewed security design.

## Push Notifications

Push is a wake signal, not a transport.

Push payloads should contain:

- Minimal agent identifier.
- Event type.
- Approval or event reference when needed.
- No full prompts, tool inputs, secrets, or session transcripts.

After a notification tap, the app should reconnect to the agent over Piper and fetch details through the paired connection.

Push registration creates a second relationship between an iOS installation and an agent. That relationship must be revocable from both ends and must not imply protocol trust unless the peer key is also allowlisted.

## Threats

### Lost Phone

Risk: A lost paired phone can control agents.

Mitigation: Store secrets in Keychain, require device unlock for sensitive actions, support allowlist revocation, and show last connected peer keys.

### Malicious Peer

Risk: A user pairs an untrusted manager.

Mitigation: Make pairing explicit, show fingerprints, document capabilities of a paired peer, and make revocation easy.

### Fake Approval Context

Risk: A compromised or confused client displays misleading approval context.

Mitigation: Keep approval payloads structured, include tool name and input from the instance, and avoid approving from push text alone.

### Malicious Surface Payload

Risk: An agent sends misleading, oversized, or markup-like surface payloads.

Mitigation: Treat payloads as inert JSON, require fallback rendering, forbid executable UI, and keep frame limits enforced.

### Remote Auth Phishing

Risk: An agent asks the user to authenticate to the wrong site, account, or scope.

Mitigation: Show domain, origin URL, scope, session destination, requesting agent, and expiry before the user proceeds. Never hide these details behind push text alone.

### Agentjacking Through Tool Inputs

Risk: External content or fake errors manipulate the coding agent into unsafe actions.

Mitigation: Treat approvals as checkpoints, show tool context, and keep security docs clear that Piper is a control plane, not a full tool sandbox.

### Hosted Service Expansion

Risk: Push or receipt services slowly become a central relay.

Mitigation: Document non-goals, keep command traffic P2P, and design hosted payloads as narrow wake or entitlement metadata.

## Release Checklist

- `docs/protocol.md` matches `src/protocol.ts`.
- `docs/compatibility.md` matches the current protocol version and version-bump rules.
- Pairing and revocation docs exist.
- Unknown peers are rejected in `scripts/selftest.ts`.
- Malformed frames do not crash the decoder.
- Approval allow, block, timeout, and disconnect cases are tested.
- Typed surfaces have fallback rendering and malformed payload coverage.
- Auth handoff payloads are reviewed for credential leakage.
- iOS Keychain storage is tested.
- Push payloads are reviewed for secret leakage.
- App Store privacy labels match actual data handling.
