# Piper Protocol

## Summary

Piper uses newline-delimited JSON messages over a HyperDHT encrypted duplex stream. The instance public key is the network address. A peer can connect only if its public key is present in the instance allowlist.

This document describes the current v0 protocol implemented by `src/protocol.ts`, `src/transport.ts`, and `src/index.ts`.

Typed agent surfaces are documented separately in `docs/surfaces.md`. They are sent over this same wire protocol as `surface` messages.

Compatibility policy and version-bump rules are documented in `docs/compatibility.md`.

## Transport

- HyperDHT provides discovery, NAT traversal, and encrypted Noise streams.
- The Piper instance listens on its persistent keypair from `.pi/piper/seed`.
- Managers connect using their own keypair.
- The instance reads `socket.remotePublicKey` and rejects any key not present in `.pi/piper/allowed.json`.
- Message framing is newline-delimited JSON.
- Empty lines are ignored.
- Malformed JSON frames are skipped.
- Frames larger than the decoder limit are skipped and reported as invalid.

## Identity

Each Piper instance has a stable keypair derived from a 32-byte seed stored at `.pi/piper/seed`.

The public key is:

- The instance address.
- The value shared with a manager client.
- Safe to display.

The seed and secret key are sensitive and must not be shared.

## Pairing

Pairing is manual. A manager peer key must be added to the instance allowlist before the manager can connect.

See `docs/pairing.md` for user-facing pairing, revocation, fingerprint, and corrupt-allowlist recovery guidance.

Current command:

```text
/piper-allow <64 hex-char peer key>
```

The allowlist is stored at `.pi/piper/allowed.json`.

Revocation removes a peer key and disconnects matching active sockets:

```text
/piper-deny <64 hex-char peer key>
```

## Versioning

Current protocol version: `1`.

Supported protocol range: `1` through `1`.

The instance sends the protocol version in the initial `hello` message:

```json
{"t":"hello","protocol":1,"instance":{"publicKey":"...","label":"workstation","cwd":"...","streaming":false}}
```

Compatibility policy:

- Additive fields are allowed without a version bump.
- New message types require clients to ignore unknown messages safely.
- New surface types require clients to show fallback text safely.
- Removing fields, renaming fields, or changing message meaning requires a protocol version bump.
- Clients should treat unknown inbound fields as optional.
- Instances should respond with a structured error when they reject a known request.
- Clients should disconnect from unsupported `hello.protocol` versions.

## Instance Presence

Presence describes the current agent instance:

```ts
interface InstancePresence {
  publicKey: string;
  label: string;
  cwd: string;
  model?: string;
  streaming: boolean;
  sessionFile?: string;
}
```

Presence is sent on connection and when important state changes.

## Manager to Instance Messages

### prompt

Send a user message to the agent.

```json
{"t":"prompt","id":"req-1","message":"Continue the refactor","streamingBehavior":"steer"}
```

When the agent is idle, the instance starts a normal prompt. When the agent is streaming, the instance delivers according to `streamingBehavior`.

### steer

Send steering text to a running agent.

```json
{"t":"steer","id":"req-2","message":"Focus only on tests now"}
```

### abort

Ask the agent session to abort current work.

```json
{"t":"abort","id":"req-3"}
```

### get_state

Request current presence.

```json
{"t":"get_state","id":"req-4"}
```

### get_messages

Request current session messages when available from Pi session state.

```json
{"t":"get_messages","id":"req-5"}
```

### approval_response

Respond to an approval request.

```json
{"t":"approval_response","id":"approval-id","decision":"allow"}
```

`decision` is either `allow` or `block`.

### auth_result

Respond to an auth handoff request with non-secret completion metadata.

```json
{"t":"auth_result","id":"auth-request-id","status":"completed","note":"signed in on phone"}
```

`status` is one of `completed`, `failed`, `expired`, `cancelled`, or `rejected`.

This message must not include passwords, passkeys, one-time codes, cookies, refresh tokens, bearer tokens, or other credentials.

## Instance to Manager Messages

### hello

Sent once after an allowlisted connection is accepted.

```json
{"t":"hello","protocol":1,"instance":{"publicKey":"...","label":"laptop","cwd":"...","streaming":false}}
```

### presence

Sent when instance state changes.

```json
{"t":"presence","instance":{"publicKey":"...","label":"laptop","cwd":"...","streaming":true}}
```

### event

Forwards Pi agent events under `event`.

```json
{"t":"event","event":{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"hello"}}}
```

Current forwarded event names:

- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`

### surface

Sends a typed agent surface that clients can render natively while preserving fallback behavior for unsupported types.

```json
{"t":"surface","surface":{"kind":"surface","surface":"event","type":"task.update","id":"evt-1","ts":1792080000000,"source":{"harness":"pi"},"schema":{"version":1},"summary":"Agent started work","fallback":"Agent started work","display":{"title":"Agent started","priority":"normal"},"payload":{"state":"running"}}}
```

Current built-in surface types include:

- `task.update`
- `notification`
- `approval.request`
- `git.commit`
- `test.result`
- `artifact.created`
- `metric.series`
- `experiment.log`
- `surface.proposal`
- `auth.request`
- `auth.result`

See `docs/surfaces.md` for field-level schema guidance, custom surface proposals, and remote authentication handoff rules.

The extension currently emits surfaces for agent lifecycle, tool lifecycle, remote approval context, surface proposals, auth requests, and auth results.

Pi-side commands:

```text
/piper-surface-propose <type> [rationale]
/piper-auth <https-url> [reason]
```

`/piper-auth` accepts HTTPS URLs. Plain HTTP is reserved for localhost development targets only.

### response

Correlates a request by `id`.

```json
{"t":"response","id":"req-1","ok":true}
```

```json
{"t":"response","id":"req-1","ok":false,"error":"message"}
```

### approval_request

Sent when remote approvals are enabled and a connected manager should decide whether a tool can run.

```json
{"t":"approval_request","id":"approval-id","toolName":"bash","input":{"command":"npm test"}}
```

Approval requests currently time out to allow so normal local sessions do not hang forever.

## Client Expectations

Clients should:

- Generate and persist their own keypair.
- Display the public key and short fingerprint for pairing.
- Preserve request IDs until a matching response arrives.
- Ignore unknown message types.
- Render unknown surfaces with their `fallback` text.
- Treat event payloads as Pi-owned data.
- Treat surface payloads as inert data, not executable UI.
- Reconnect and request state after network interruptions.
- Consider approval requests stale after timeout or disconnect.

## Server Expectations

Instances should:

- Fail closed for unpaired peers.
- Disconnect active sockets when a paired key is revoked.
- Avoid logging secret keys.
- Send `hello` only after allowlist acceptance.
- Keep malformed frames from crashing the process.
- Destroy sockets on shutdown.
- Avoid making hosted services part of the command path.
