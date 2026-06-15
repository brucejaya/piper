# Piper Reference CLI

`test-peer/cli.ts` is the open reference manager for Piper. It is intentionally small, but it exercises the same protocol surfaces that native apps will wrap later.

## Identity

The CLI creates a persistent peer keypair under `~/.piper-peer/seed`.

Print the peer key:

```bash
npm run peer
```

Pair it inside the Pi session:

```text
/piper-allow <peer-key>
```

## Connect Interactively

```bash
npm run peer -- <instance-key>
```

Interactive commands:

```text
/help
/state
/messages
/abort
/steer <message>
/approve <approval-id> [reason]
/block <approval-id> [reason]
/auth-result <request-id> <completed|failed|expired|cancelled|rejected> [note]
/quit
```

Any other non-empty line is sent as a `prompt`.

## One-Shot Commands

Request current instance state:

```bash
npm run peer -- <instance-key> --state
```

Request current session messages:

```bash
npm run peer -- <instance-key> --messages
```

Send a prompt and exit after the response acknowledgement:

```bash
npm run peer -- <instance-key> --prompt "summarize current state"
```

Steer a running agent:

```bash
npm run peer -- <instance-key> --steer "focus on tests now"
```

Abort current work:

```bash
npm run peer -- <instance-key> --abort
```

## Approvals

When the instance sends an `approval_request`, the reference CLI prints the approval id, tool name, and input. Respond interactively:

```text
/approve <approval-id> [reason]
/block <approval-id> [reason]
```

For unattended local tests, set `PIPER_AUTO_APPROVE=1` before launching the CLI. This keeps auto-allow behavior explicit instead of surprising.

## Typed Surfaces

When the instance sends a `surface` message, the CLI prints a readable fallback line. Known types such as `task.update`, `approval.request`, `git.commit`, `auth.request`, and `auth.result` get clearer labels. Unknown types print their `fallback` text and JSON payload.

The CLI does not grant elevated rendering, notification permissions, or action privileges for custom surfaces. It is a debugging client, not the trust UI for surface proposals.

## Auth Handoff Testing

When a Pi instance sends an `auth.request` surface, the CLI prints the surface id. Respond with non-secret completion metadata:

```text
/auth-result <request-id> completed signed in on phone
```

The CLI never sends passwords, one-time codes, cookies, refresh tokens, bearer tokens, or browser session data.

## Pi-Side Surface Commands

Inside the Pi session, the extension exposes:

```text
/piper-surface-propose <type> [rationale]
/piper-auth <https-url> [reason]
```

These commands emit `surface.proposal` and `auth.request` surfaces to connected managers.

## Testnet Bootstrap

Use `PIPER_BOOTSTRAP` to point the peer at a private or local DHT bootstrap:

```bash
PIPER_BOOTSTRAP=127.0.0.1:12345 npm run peer -- <instance-key>
```

On Windows PowerShell:

```powershell
$env:PIPER_BOOTSTRAP="127.0.0.1:12345"; npm run peer -- <instance-key>
```

## CLI Tests

Run parser and identity checks without opening a network socket:

```bash
npm run clitest
```
