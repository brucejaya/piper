# Piper Compatibility Policy

## Summary

Piper protocol compatibility is intentionally conservative. The open CLI, third-party clients, and the official iOS app should be able to implement `docs/protocol.md` without guessing which changes are safe.

Current protocol version: `1`.

Supported protocol range:

- Minimum: `1`
- Maximum: `1`

The instance advertises its protocol version in the initial `hello` message. Clients must check that version before sending commands.

## Compatible Changes

These changes do not require a protocol version bump:

- Adding optional fields to existing messages.
- Adding a new instance-to-manager message type that old clients can ignore.
- Adding a new surface `type` when the surface includes `fallback` text.
- Adding optional fields inside a surface payload.
- Adding new CLI commands that use existing protocol behavior.
- Improving docs without changing message meaning.

## Version-Bump Changes

These changes require a protocol version bump:

- Removing a message field.
- Renaming a message field.
- Changing the meaning of an existing field.
- Changing request/response correlation rules.
- Changing line framing away from newline-delimited JSON.
- Changing auth, approval, pairing, or revocation semantics.
- Requiring clients to understand a previously optional message.
- Removing fallback behavior for unknown surfaces.

## Client Rules

Clients should:

- Reject `hello.protocol` values below the supported minimum.
- Reject `hello.protocol` values above the supported maximum unless the client explicitly implements forward compatibility for that version.
- Ignore unknown instance-to-manager message types.
- Preserve request IDs until a matching `response` arrives or the connection closes.
- Render unknown surfaces with their `fallback` text.
- Treat surface payloads as inert JSON.

## Instance Rules

Instances should:

- Send `hello` before accepting commands from a peer.
- Include the current protocol version in `hello`.
- Ignore unknown inbound fields.
- Return structured `response` errors for known request types that fail.
- Return structured `response` errors for unknown request types when the request includes an `id`.
- Keep malformed frames from crashing the process.

## Release Notes

Every release that changes `src/protocol.ts` should update:

- `docs/protocol.md`
- `docs/compatibility.md`
- `docs/security.md` when trust boundaries change
- `docs/surfaces.md` when typed surface contracts change

Wire changes should be called out in release notes with:

- The old behavior.
- The new behavior.
- Whether old clients remain compatible.
- Any required migration steps.
