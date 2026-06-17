# Local Two-Agent Pairing

Piper's `src/extension` makes a Pi instance a key-addressed server. For
two-local-agents development — a "cloud" Pi on the same machine as a
local coding agent that drives it — you don't want either side hitting the
public HyperDHT. The `localdht` daemon and `peer-session` script give you a
fully offline flow that uses the same protocol and the same package code.

The published `piper` package is unchanged: `PIPER_BOOTSTRAP` is already a
first-class input to the transport, and the `peer-session` and `localdht`
helpers live in `scripts/` (dev-only, not in `dist/`).

## Quick start

Three terminals.

**Terminal 1 — local DHT**

```bash
npm run localdht
```

This boots a HyperDHT node, writes the bootstrap address to
`~/.piper-local/bootstrap`, and prints `export PIPER_BOOTSTRAP=127.0.0.1:NNNNN`
for shell consumption. Stop with Ctrl+C.

**Terminal 2 — Piper instance (the "cloud" Pi)**

```bash
export PIPER_BOOTSTRAP=$(cat ~/.piper-local/bootstrap)
pi -e "$(pwd)/src/index.ts"
```

The extension prints its instance key on start. Copy it. Note the
`piper-allow` command requires the peer's pubkey — get that next.

**Terminal 3 — peer CLI**

```bash
export PIPER_BOOTSTRAP=$(cat ~/.piper-local/bootstrap)
npm run peer -- keys       # print this peer's pubkey
npm run peer -- use <instance-key>   # pin the default
```

Copy the printed peer pubkey into Terminal 2:

```
/piper-allow <peer-pubkey>
```

Then drive the instance from Terminal 3 with the subcommand CLI:

```bash
npm run peer -- send prompt "do thing"
npm run peer -- request get-state
npm run peer -- watch             # long-lived event stream (pretty)
npm run peer -- repl              # interactive REPL
```

For the local coding agent: pass `--json` to get NDJSON on stdout, errors
as `{"t":"error","reason":"..."}` on stderr, exit code 1. See
[the CLI surface](#cli-surface) below for every subcommand.


## CLI surface

The peer CLI exposes every protocol message plus a small admin surface. Default
output is human-friendly; `--json` switches to NDJSON for scripted callers.

```text
Identity & default instance
  piper keys                                    # print this peer's pubkey
  piper use <instance-key>                      # pin default (~/.piper-peer/config.json)
  piper use --clear                             # clear the default
  # PIPER_INSTANCE env var overrides the default

Monitored instances (for `watch --all`)
  piper instances list
  piper instances add <key> [--label <text>]   # persist in ~/.piper-peer/instances.json
  piper instances remove <key>

Send a request
  piper send prompt <text> [--steer|--follow-up] [--stream] [instance]
  piper send steer <text> [instance]
  piper abort [instance]

Request
  piper request get-state [instance]
  piper request get-messages [instance]

Respond to a pending request
  piper respond approval <id> --allow|--block [--reason <text>] [instance]
  piper respond auth-result <id> --status <completed|failed|expired|cancelled|rejected> [--note <text>] [instance]

Stream
  piper watch [<key>...]                        # one or many; or `piper watch --all` for the monitored list
  piper repl [instance]                         # interactive REPL

Global flags
  --json, --id <id>, --bootstrap <host:port>, --peer-home <dir>, --help
```

Exit codes: `0` success, `1` protocol / runtime error, `2` usage error.

### Stream modes

`piper send prompt --stream <text>` opens a long-lived connection, sends the
prompt, and forwards all subsequent outbound events (text deltas, tool calls,
presence, surfaces, approval requests) to stdout. The CLI stays open until
SIGINT or the socket closes — there is no implicit "agent_end closes the
stream" semantic. Use this when you want to drive one task and see everything
the agent does.

`piper watch <key1> <key2> ...` opens long-lived connections to N instances
and prints every event from all of them, tagged with `instanceKey` and
`instanceLabel` so a multi-agent dashboard can disambiguate. `piper watch
--all` reads the monitored list. The CLI auto-reconnects on socket close
with 1s/2s/4s/8s/16s backoff (5 attempts) before giving up.

`piper repl <instance>` is a single-instance interactive REPL. Bare text is
a prompt; `/state`, `/messages`, `/abort`, `/approve <id>`, `/block <id>` are
shortcuts. `/quit` or Ctrl-C disconnects.

### Auth handoff surfaces

When the instance broadcasts an `auth_request` surface, the CLI extracts the
request id and prints a copy-pastable `piper respond auth-result <id>
--status completed|failed|...` line. The CLI does not auto-respond.


`piper pair <instance>` and `piper revoke <instance>` are deliberately
**not** in the CLI. Pairing lives on the instance side via `/piper-allow
<peer-key>`; revocation via `/piper-deny <peer-key>`. The peer only needs to
print its own pubkey for the instance to allow.

The trailing `[instance]` argument, when present, overrides the default. If
omitted, the default instance (`piper use` or `$PIPER_INSTANCE`) is used.

## Line protocol (peer-session)

The session emits one NDJSON line per outbound event. Each line is either an
`OutboundMessage` from `src/protocol.ts` (forwarded verbatim) or a session
lifecycle envelope:

```json
{ "t": "session", "state": "open", "peerKey": "<my-pubkey>" }
{ "t": "session", "state": "ready", "hello": { ... } }
{ "t": "session", "state": "closed" }
{ "t": "session", "state": "error", "reason": "..." }
{ "t": "hello", "protocol": 1, "instance": { ... } }
{ "t": "presence", "instance": { ... } }
{ "t": "event", "event": { "type": "message_update", ... } }
{ "t": "surface", "surface": { ... } }
{ "t": "response", "id": "<your-id>", "ok": true, "data": ... }
{ "t": "response", "id": "<your-id>", "ok": false, "error": "..." }
{ "t": "approval_request", "id": "...", "toolName": "...", "input": ... }
```

Inbound requests are written as one NDJSON line to stdin. Each request must
carry a caller-supplied `id`; the matching `response` (ok or error) ends the
request. Examples:

```json
{ "t": "prompt", "id": "p1", "message": "do thing" }
{ "t": "get_state", "id": "s1" }
{ "t": "approval_response", "id": "approval-1", "decision": "allow" }
{ "t": "approval_response", "id": "approval-2", "decision": "block", "reason": "unsafe" }
```

The session auto-approves on `approval_request` if `PIPER_AUTO_APPROVE=1` is
set. Otherwise the local agent must write an `approval_response` line.

`/quit` (or `/exit`) on stdin tears down the connection.

## Drive from a coding agent

A typical loop:

1. Spawn `peer-session` with the instance key.
2. Read NDJSON lines from its stdout.
3. For each `event` with `type: "message_update"`, render the text delta.
4. When `event.type === "agent_end"`, the current prompt is done.
5. Write a new `prompt` with a fresh id; loop.

`get_state` and `get_messages` are independent of the running task and can
be sent at any time. They produce a `response` (not a stream) and the local
agent correlates on the request id.

## Why a separate DHT instead of the public one

The public HyperDHT is fine for production but unsuitable for tight
agent-to-agent development: NAT traversal is slow, debugging is impossible
across the public network, and there's no way to reproduce a specific
sequence of events. A local DHT collapses all of that into a single machine
where you can `console.log` everything.

`localdht` is a small script: it doesn't multiplex or proxy, it just exposes
the same DHT API on `127.0.0.1` and writes its address to a known file. Both
the Piper instance and the peer session read that file (or honour
`PIPER_BOOTSTRAP` if you set it explicitly). No code change in the package
is required to switch between local and public DHT — only the env var
changes.
