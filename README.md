# Piper

**`sshd` for [Pi](https://github.com/earendil-works/pi).** A Pi extension that turns any
Pi coding-agent instance into an encrypted, key-addressed control surface over
[HyperDHT](https://github.com/holepunchto/hyperdht), so you can reach and drive
your agents from anywhere with no server, static IP, or port forwarding.

Piper is the open networking and trust layer. Native apps can wrap the same core
functions later; the included terminal `test-peer` is the reference manager
until those clients exist.

## How It Works

- **Identity** - each instance has a persistent keypair in `.pi/piper/`. Its
  public key is its address.
- **Reachability** - the extension opens a HyperDHT server on that key when Pi
  starts. Connections are NAT hole-punched and Noise-encrypted end to end.
- **Trust** - manual pairing. An instance only accepts connections from peer
  public keys added to `.pi/piper/allowed.json`.
- **Revocation** - `/piper-deny <peer-key>` removes a peer key and disconnects
  any active socket using that key.
- **Protocol** - newline-delimited JSON over the encrypted socket. The instance
  forwards Pi's native `AgentEvent` stream and accepts `prompt`, `steer`,
  `abort`, `get_state`, and `get_messages`.
- **Approvals** - opt in with `PIPER_APPROVALS=remote` to ask a connected
  manager to allow or block tool calls.

See [docs/protocol.md](docs/protocol.md) for the wire protocol and
[docs/security.md](docs/security.md) for the trust model. Pairing and revocation
details live in [docs/pairing.md](docs/pairing.md).

## Install the Extension

```bash
npm install
npm run typecheck
npm run clitest
npm run pushtest
npm run selftest
npm run livetest
```

`clitest` checks the reference manager parser and identity persistence without
opening a network socket.
`selftest` is the offline transport and trust test over a local DHT testnet.
`livetest` runs the real extension inside a real Pi SDK session backed by a real
provider. It uses the isolated agent dir at `.pi/agent`; configure provider
auth in `.pi/agent/auth.json`.

Then point Pi at the extension. Either add it to Pi settings
(`~/.pi/agent/settings.json`):

```json
{ "extensions": ["C:/Users/you/Documents/Misc/Code/Piper/src/index.ts"] }
```

Or load it ad hoc for a session:

```bash
pi -e "C:/Users/you/Documents/Misc/Code/Piper/src/index.ts"
```

On start it prints the instance key and begins listening.

## Pair, Revoke, and Drive

```bash
# 1. In another terminal, get the test-peer's public key.
npm run peer
# -> prints: <peer-key>

# 2. In the Pi session running the extension, pair that key.
/piper-allow <peer-key>

# 3. Connect the peer to the instance and start prompting.
npm run peer -- <instance-key>
```

Useful Pi commands:

```text
/piper
/piper-allow <peer-key>
/piper-deny <peer-key>
/piper-surface-propose <type> [rationale]
/piper-auth <https-url> [reason]
```

`/piper` shows the instance key, label, listening state, connected peer count,
approval mode, and paired keys. Connected paired keys are marked.

## Config

| Env var               | Default       | Meaning                                           |
| --------------------- | ------------- | ------------------------------------------------- |
| `PIPER_LABEL`         | hostname      | Friendly name advertised to managers              |
| `PIPER_APPROVALS`     | `off`         | `remote` asks a connected manager before each tool |
| `PIPER_APPROVAL_TIMEOUT_MS` | `30000` | Remote approval timeout before allowing locally |
| `PIPER_AUTO_APPROVE`  | unset         | `1` makes the reference CLI auto-allow approvals  |
| `PIPER_BOOTSTRAP`     | public DHT    | `host:port,...` private/testnet DHT bootstrap     |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | Pi config/auth/session dir for isolation          |
| `PIPER_PEER_HOME`     | `~/.piper-peer` | Reference CLI identity dir override             |

## Layout

```text
src/identity.ts       keypair load/create (.pi/piper/seed)
src/allowlist.ts      manual-pairing trust (.pi/piper/allowed.json)
src/protocol.ts       wire types + newline-JSON framing
src/transport.ts      HyperDHT server, allowlist gate, peers
src/index.ts          Pi extension: bridges Pi <-> transport
test-peer/cli.ts      terminal reference manager
scripts/clitest.ts    offline reference CLI parser/identity checks
scripts/pushtest.ts   offline push wake payload privacy checks
scripts/selftest.ts   offline transport/trust integration test
scripts/livetest.ts   live Pi bridge integration test
scripts/tooltest.ts   live tool forwarding + approvals test
```

## Project Docs

- [docs/protocol.md](docs/protocol.md) - current wire protocol.
- [docs/compatibility.md](docs/compatibility.md) - versioning and compatibility policy.
- [docs/pairing.md](docs/pairing.md) - public-key pairing and revocation.
- [docs/security.md](docs/security.md) - trust model and threat boundaries.
- [docs/cli.md](docs/cli.md) - reference manager CLI usage.
- [docs/ios-prd.md](docs/ios-prd.md) - paid iOS app product requirements.
- [docs/ios-networking-spike.md](docs/ios-networking-spike.md) - iOS HyperDHT networking approach.
- [apps/ios/README.md](apps/ios/README.md) - native iOS app scaffold and Mac setup.
- [docs/plans/2026-06-15-001-feat-piper-development-roadmap-plan.md](docs/plans/2026-06-15-001-feat-piper-development-roadmap-plan.md) - full development roadmap.

## Status

v0 has transport, identity, pairing, revocation, event forwarding, remote
prompting, and protocol hardening covered by `selftest`. The live bridge and
remote approvals path are implemented and covered by live scripts when provider
credentials are available. Multi-instance fleet management and native apps are
next.
