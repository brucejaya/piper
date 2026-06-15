# Piper iOS Product Requirements

## Summary

The official Piper iOS app is the paid mobile client for the open Piper protocol. It should let a user monitor, steer, approve, and review persistent coding agents while away from their desk. The app sells native mobile experience, not access to the protocol.

## Positioning

Piper for iOS is not a mobile SSH app, remote desktop app, or generic chat client. It is an agent-control surface for long-running coding agents.

The core promise is: "I can trust this phone to see what my agents are doing, approve risky actions, and intervene when needed."

Recent community research suggests the strongest wedge is trust. Self-hosters are already aware of dashboards, tmux wrappers, and mobile UIs. What they need answered is why a remote control surface can be trusted with a coding agent that may touch credentials, files, repos, and tools.

## Target Users

- Independent developers running Pi, Codex, Claude Code, or similar agents on a laptop, desktop, VPS, or home server.
- Self-hosters who prefer local control, public-key trust, and minimal hosted infrastructure.
- Power users who run long agent tasks and need approvals, steering, or monitoring while away.
- Researchers and builders experimenting with persistent agents, memory, or autonomous development loops.

## Core Jobs

- See whether each agent is idle, busy, disconnected, or waiting for approval.
- Read streamed progress without opening a terminal or browser tab.
- Send a prompt, steer a running task, or abort a bad run.
- Approve or block tool execution with enough context to decide safely.
- Review recent session history when the agent or phone was offline.
- Manage paired agents and revoke a lost or retired device.

## Product Requirements

### Pairing and Trust

- The app must create a persistent peer keypair and store its secret in Keychain.
- The app must show its public key and short fingerprint for pairing.
- The app must support QR and copy/paste pairing flows without changing the public-key trust model.
- The app must show which agents are paired locally and when each was last seen.
- The app must support removing a local agent entry without implying server-side revocation.
- The product docs must explain that true revocation happens on the agent instance allowlist.

### Agent Dashboard

- The first screen must be the agent dashboard, not marketing copy.
- Each agent row must show label, short key, connection state, busy or idle state, last activity, model when known, and current working directory when known.
- Offline and stale states must be visually distinct from connected idle states.
- The dashboard must scale from one personal agent to a small fleet across laptop, desktop, VPS, and home server.

### Session View

- The session view must show assistant messages, user prompts, tool starts, tool updates, tool completions, and errors.
- The session view must render typed surfaces as native timeline items when supported, with safe fallback cards for unknown surface types.
- Streaming text must append in order and tolerate reconnects.
- The user must be able to send a new prompt, steer a running task, and abort.
- The UI must distinguish "follow-up while idle" from "steer while busy" so users understand what the agent will receive.

### Typed Surfaces

- The app must render built-in surfaces from `docs/surfaces.md` using native UI, not web views or agent-provided markup.
- `task.update` should appear as timeline progress rows.
- `notification` should appear as compact activity rows.
- `approval.request` should appear as an approval card or sheet with explicit allow/block actions.
- `git.commit`, `test.result`, `artifact.created`, `metric.series`, and `experiment.log` should appear as structured cards with detail views.
- `surface.proposal` should appear as a trust decision, not as automatically enabled UI.
- Unknown surfaces must show fallback text, source context, and optional raw payload inspection for technical users.
- Redacted or oversized payloads must have an understandable collapsed state.

### Approval Workflow

- Approval requests must be first-class cards, not hidden in the transcript.
- Each card must show agent label, tool name, summarized input, risk cues, timeout state, and allow/block actions.
- Allow and block decisions must be sent over the paired Piper connection.
- Stale approval cards must expire visibly and must not be actionable after the agent has moved on.
- The app must survive duplicate approval events without showing duplicate decisions.

### Notifications

- Push notifications must wake the user for agent attention events, especially approvals.
- Push payloads must be minimal wake hints, not command relay or full session transport.
- Opening a notification should reconnect to the agent and fetch approval or session details over Piper.
- Notification registration must be revocable from the phone and from the agent side.

### Remote Authentication Handoff

- Auth requests must be first-class high-trust cards or sheets.
- Each auth request must show the requesting agent, target domain, origin URL, requested scope or reason, session destination, and expiry.
- The user must be able to complete, cancel, or reject the handoff remotely.
- The app must not expose raw passwords, passkeys, one-time codes, cookies, refresh tokens, or bearer tokens to the agent.
- The first implementation should return only non-secret completion metadata to the agent.
- Auth handoff events must be visible in local history.
- Rich browser session transfer is out of scope until a separate reviewed security design exists.

### Local History

- The app must cache recent messages, events, and approval outcomes locally per agent.
- Cached history must be clearly marked stale when disconnected.
- The app must reconstruct message text from deltas.
- The app must prune old cache entries with a predictable retention policy.

### Payments

- The app must support monthly, annual, and lifetime products through StoreKit.
- Lifetime purchase should be prominent, not hidden behind subscriptions.
- Entitlements must unlock the official app experience only.
- Entitlements must not alter the open protocol, peer trust, or agent allowlist behavior.
- Purchase restore must work after reinstall.

## Non-Goals

- No hosted relay for ordinary prompts, approvals, or session traffic.
- No general SSH shell.
- No remote desktop.
- No multi-user organization administration in v1.
- No web dashboard or promotional landing page in this development pipeline.
- No protocol lock-in that prevents alternative clients.

## Success Criteria

- A self-hoster can understand the trust model before pairing.
- A user can pair an agent, see it online, send a prompt, and receive streamed output.
- A user can approve or block a tool request from the phone.
- A user can leave the app, receive a notification, reopen, and reconnect to the right agent context.
- A user can restore a paid entitlement without affecting any agent pairing.
- A third-party client can still implement the open protocol without the iOS app.

## MVP Cut

- Pairing by copy/paste public key and short fingerprint.
- Agent list with connected, busy, idle, and offline states.
- Session transcript with message streaming and tool event display.
- Prompt, steer, abort, and get state.
- Remote approvals in foreground.
- Typed surface rendering for built-in schemas and safe unknown fallback.
- Remote auth request display with metadata-only completion.
- Local recent-history cache.
- StoreKit monthly, annual, and lifetime products.

## Beta Cut

- QR pairing.
- Push wake hints for approvals and important state changes.
- Approval notification deep links.
- Agent-side push registration and revocation.
- Better cache reconciliation after reconnect.
- App Store privacy and support documentation.

## Open Questions

- Which iOS networking strategy should carry HyperDHT: native Swift implementation, embedded library, local bridge, or fallback transport?
- How much tool input can be shown safely in approval notifications before leaking sensitive context?
- What retention period should local history use by default?
- Should the free app tier allow one paired agent for trial, or should trialing rely on subscription mechanics?

## Networking Spike

The initial networking direction and gate for app UI work are documented in `docs/ios-networking-spike.md`.
