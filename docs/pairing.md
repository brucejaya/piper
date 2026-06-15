# Piper Pairing

## Summary

Piper pairing is public-key allowlisting. An agent instance has an instance public key. Each manager client has its own peer public key. The instance accepts only peer keys present in `.pi/piper/allowed.json`.

QR codes, copy buttons, and short fingerprints are display helpers. The trust decision is still the full public key.

## Instance Key

When the Piper extension starts, it creates or loads:

```text
.pi/piper/seed
```

The derived public key is the instance address. It is safe to display and share. The seed is secret and must not be copied to another machine.

Show the instance status inside Pi:

```text
/piper
```

## Peer Key

The reference CLI creates a persistent peer key under:

```text
~/.piper-peer/seed
```

Print the peer public key:

```bash
npm run peer
```

For tests, override the peer identity directory:

```bash
PIPER_PEER_HOME=/tmp/piper-peer npm run peer
```

## Pair A Peer

Inside the Pi session running Piper:

```text
/piper-allow <64 hex-char peer key>
```

Pairing is idempotent. Adding the same peer twice keeps a single allowlist entry.

## Revoke A Peer

Inside the Pi session:

```text
/piper-deny <64 hex-char peer key>
```

Revocation removes the key from `.pi/piper/allowed.json` and disconnects active sockets using that peer key. Removing an agent from a phone or deleting a local CLI identity does not revoke protocol access. True revocation happens on the agent instance.

## Fingerprints

Clients should show:

- The full key for copy/paste.
- A short fingerprint for comparison.
- A device label when available.
- Connected or last-seen state when available.

Short fingerprints are for human comparison only. They are not a replacement for the full key.

## Invalid Or Corrupt Allowlist

Piper accepts only 64-character hex public keys. Invalid keys are rejected by commands and ignored when loading the allowlist.

If `.pi/piper/allowed.json` is corrupt, Piper fails closed and treats the allowlist as empty. Keep the corrupt file for inspection, then repair it to a JSON array of peer public keys:

```json
[
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
]
```

## QR Pairing

Future clients may encode the peer public key in a QR code. QR pairing must still show the key or fingerprint before trust is granted. Scanning a QR code is a transport for the public key, not a new trust model.
